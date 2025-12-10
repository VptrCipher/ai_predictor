// news-aggregator.js - Multi-source News Aggregation with ML Filtering - UPDATED

class NewsAggregator {
    constructor() {
        this.newsSources = [
            {
                name: 'NewsAPI',
                key: '06e8ae8f37b549a5bb8727f9e46bbfc3',
                url: 'https://newsapi.org/v2/everything',
                enabled: this.isValidKey('06e8ae8f37b549a5bb8727f9e46bbfc3')
            },
            {
                name: 'StockData',
                key: 'H9IuvBwPXRLWDdJhnia5uwDsujNk106qGLyL3yW4',
                url: 'https://api.stockdata.org/v1/news/all',
                enabled: this.isValidKey('H9IuvBwPXRLWDdJhnia5uwDsujNk106qGLyL3yW4')
            },
            {
                name: 'Finnhub',
                key: 'd4ivcg1r01queuakp4pgd4ivcg1r01queuakp4q0',
                url: 'https://finnhub.io/api/v1/company-news',
                enabled: this.isValidKey('d4ivcg1r01queuakp4pgd4ivcg1r01queuakp4q0')
            }
        ];
        
        this.newsCache = new Map();
        this.cacheDuration = 5 * 60 * 1000; // 5 minutes cache
    }

    isValidKey(key) {
        return key && key !== 'demo' && !key.includes('YOUR_') && key.length > 10;
    }

    calculateRelevanceScore(article, symbol, companyName) {
        let score = 0;
        const text = `${article.title || ''} ${article.description || ''} ${article.content || ''}`.toLowerCase();
        const symbolLower = symbol.toLowerCase();
        const companyWords = companyName ? companyName.toLowerCase().split(' ') : [];
        
        // Direct symbol match in title
        if (article.title?.toLowerCase().includes(symbolLower)) score += 40;
        
        // Direct symbol match in content
        if (text.includes(symbolLower)) score += 20;
        
        // Company name words
        companyWords.forEach(word => {
            if (word.length > 2) { // Avoid short words
                const regex = new RegExp(`\\b${word}\\b`, 'i');
                if (regex.test(text)) score += 15;
            }
        });
        
        // Financial keywords with weights
        const financialKeywords = {
            'stock': 8, 'market': 7, 'earnings': 10, 'revenue': 9, 'profit': 8,
            'dividend': 7, 'quarterly': 6, 'annual': 6, 'forecast': 8, 'target': 9,
            'price': 8, 'analyst': 7, 'upgrade': 9, 'downgrade': 9, 'maintain': 6,
            'outperform': 8, 'hold': 6, 'sell': 7, 'buy': 8, 'rating': 7,
            'guidance': 8, 'results': 7, 'performance': 6, 'growth': 7, 'margin': 6
        };
        
        Object.entries(financialKeywords).forEach(([keyword, weight]) => {
            if (text.includes(keyword)) score += weight;
        });
        
        // Recency bonus
        try {
            const articleDate = new Date(article.publishedAt || article.published_at || Date.now());
            const hoursAgo = (Date.now() - articleDate.getTime()) / (1000 * 60 * 60);
            
            if (hoursAgo < 1) score += 20;      // Less than 1 hour
            else if (hoursAgo < 6) score += 15; // Less than 6 hours
            else if (hoursAgo < 24) score += 10; // Less than 24 hours
            else if (hoursAgo < 48) score += 5;  // Less than 48 hours
        } catch (e) {
            // Date parsing failed
        }
        
        // Source credibility
        const credibleSources = {
            'bloomberg': 10, 'reuters': 10, 'wsj': 10, 'wall street journal': 10,
            'financial times': 10, 'cnbc': 9, 'yahoo finance': 8, 'marketwatch': 8,
            'seeking alpha': 7, 'benzinga': 7, 'investor\'s business daily': 8,
            'the motley fool': 7, 'zacks': 7, 'barrons': 9
        };
        
        const sourceName = (article.source?.name || article.source || '').toLowerCase();
        Object.entries(credibleSources).forEach(([source, credibility]) => {
            if (sourceName.includes(source)) score += credibility;
        });
        
        // Penalize generic/garbage articles
        const genericPhrases = [
            'must-watch', 'in focus', 'on wall street', 'what you need to know',
            'this week', 'today', 'breaking', 'hot', 'trending'
        ];
        
        const title = article.title?.toLowerCase() || '';
        genericPhrases.forEach(phrase => {
            if (title.includes(phrase)) score -= 5;
        });
        
        // Length bonus (more substantial articles)
        const contentLength = text.length;
        if (contentLength > 500) score += 5;
        if (contentLength > 1000) score += 5;
        
        return Math.min(100, Math.max(10, score));
    }

    async fetchFromNewsAPI(symbol, companyName) {
        const source = this.newsSources.find(s => s.name === 'NewsAPI');
        if (!source.enabled) return [];
        
        try {
            // More specific query to avoid generic news
            const query = `"${symbol}" OR "${companyName}" stock earnings financial`;
            const url = `${source.url}?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=6&apiKey=${source.key}`;
            
            const response = await fetch(url);
            if (!response.ok) return [];
            
            const data = await response.json();
            if (data.status === 'error') return [];
            
            return data.articles?.map(article => ({
                ...article,
                _source: 'NewsAPI',
                _relevance: this.calculateRelevanceScore(article, symbol, companyName)
            })) || [];
            
        } catch (error) {
            console.warn('NewsAPI error:', error.message);
            return [];
        }
    }

    async fetchFromStockData(symbol) {
        const source = this.newsSources.find(s => s.name === 'StockData');
        if (!source.enabled) return [];
        
        try {
            const url = `${source.url}?symbols=${encodeURIComponent(symbol)}&filter_entities=true&limit=6&api_token=${source.key}`;
            const response = await fetch(url);
            if (!response.ok) return [];
            
            const data = await response.json();
            return data.data?.map(article => ({
                title: article.title,
                description: article.description,
                url: article.url,
                urlToImage: article.image_url,
                publishedAt: article.published_at,
                source: { name: article.source },
                _source: 'StockData',
                _relevance: this.calculateRelevanceScore({
                    title: article.title,
                    description: article.description
                }, symbol, '')
            })) || [];
            
        } catch (error) {
            console.warn('StockData error:', error.message);
            return [];
        }
    }

    async fetchFromFinnhub(symbol, companyName) {
        const source = this.newsSources.find(s => s.name === 'Finnhub');
        if (!source.enabled) return [];
        
        try {
            const to = new Date().toISOString().split('T')[0];
            const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Last 7 days
            
            const url = `${source.url}?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${source.key}`;
            const response = await fetch(url);
            if (!response.ok) return [];
            
            const data = await response.json();
            return data?.map(article => ({
                title: article.headline,
                description: article.summary,
                url: article.url,
                urlToImage: article.image,
                publishedAt: new Date(article.datetime * 1000).toISOString(),
                source: { name: article.source },
                _source: 'Finnhub',
                _relevance: this.calculateRelevanceScore({
                    title: article.headline,
                    description: article.summary
                }, symbol, companyName)
            })).filter(article => article._relevance >= 30) || []; // Filter low relevance
            
        } catch (error) {
            console.warn('Finnhub error:', error.message);
            return [];
        }
    }

    deduplicateArticles(articles) {
        const seenTitles = new Set();
        const uniqueArticles = [];
        
        // Sort by relevance first
        articles.sort((a, b) => b._relevance - a._relevance);
        
        for (const article of articles) {
            const title = article.title?.toLowerCase().trim();
            if (!title || title.length < 10) continue; // Skip very short titles
            
            // Create a normalized version for comparison
            const normalizedTitle = title
                .replace(/[^\w\s]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            
            if (!seenTitles.has(normalizedTitle)) {
                seenTitles.add(normalizedTitle);
                uniqueArticles.push(article);
            }
        }
        
        return uniqueArticles;
    }

    async fetchNewsForStock(symbol, companyName = '') {
        const cacheKey = `${symbol}-${companyName}`;
        const cached = this.newsCache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
            console.log(`Using cached news for ${symbol}`);
            return cached.articles;
        }
        
        console.log(`Fetching relevant news for ${symbol} from multiple sources...`);
        
        const promises = [
            this.fetchFromFinnhub(symbol, companyName), // Finnhub first (usually most relevant)
            this.fetchFromStockData(symbol),
            this.fetchFromNewsAPI(symbol, companyName)
        ];
        
        const results = await Promise.allSettled(promises);
        let allArticles = [];
        
        results.forEach((result) => {
            if (result.status === 'fulfilled') {
                allArticles = allArticles.concat(result.value);
            }
        });
        
        // Filter out low relevance articles
        allArticles = allArticles.filter(article => article._relevance >= 40);
        
        // Deduplicate
        allArticles = this.deduplicateArticles(allArticles);
        
        // Sort by relevance
        allArticles.sort((a, b) => b._relevance - a._relevance);
        
        const finalArticles = allArticles.slice(0, 15); // Limit to 15 most relevant
        
        this.newsCache.set(cacheKey, {
            articles: finalArticles,
            timestamp: Date.now()
        });
        
        console.log(`Found ${finalArticles.length} relevant articles for ${symbol}`);
        return finalArticles;
    }

    getActiveSources() {
        return this.newsSources.filter(source => source.enabled).map(source => source.name);
    }
}

window.NewsAggregator = NewsAggregator;