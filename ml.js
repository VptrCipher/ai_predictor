/// ml.js - Advanced ML Stock Prediction Module

class MLStockPredictor {
    constructor() {
        this.model = null;
        this.isModelReady = false;
        this.sequenceLength = 30;
        this.featureCount = 8;
        this.predictionCache = new Map(); // Store predictions by ticker
        this.CACHE_TTL_MS = 300000; // 5 minutes
    }

    // ----- Technical Indicators -----

    calculateIndicators(prices) {
        // Always return a non-null object with sane defaults
        if (!prices || prices.length === 0) {
            return {
                sma5: 0,
                sma10: 0,
                sma20: 0,
                ema12: 0,
                ema26: 0,
                rsi: 50,
                macd: 0,
                volatility: 0
            };
        }

        const lastPrice = prices[prices.length - 1];

        return {
            sma5: this.calculateSMA(prices, 5) ?? lastPrice,
            sma10: this.calculateSMA(prices, 10) ?? lastPrice,
            sma20: this.calculateSMA(prices, 20) ?? lastPrice,
            ema12: this.calculateEMA(prices, 12) ?? lastPrice,
            ema26: this.calculateEMA(prices, 26) ?? lastPrice,
            rsi: this.calculateRSI(prices, 14),
            macd: this.calculateMACD(prices),
            volatility: this.calculateVolatility(prices, 20)
        };
    }

    calculateSMA(prices, period) {
        if (!prices || prices.length < period) {
            if (!prices || prices.length === 0) return 0;
            return prices[prices.length - 1];
        }
        const slice = prices.slice(-period);
        const sum = slice.reduce((a, b) => a + b, 0);
        return sum / period;
    }

    calculateEMA(prices, period) {
        if (!prices || prices.length === 0) return 0;
        if (prices.length < period) {
            // Fallback to last price if too little data
            return prices[prices.length - 1];
        }

        const multiplier = 2 / (period + 1);
        let ema = this.calculateSMA(prices.slice(0, period), period);

        for (let i = period; i < prices.length; i++) {
            ema = (prices[i] - ema) * multiplier + ema;
        }

        return ema;
    }

    calculateRSI(prices, period = 14) {
        if (!prices || prices.length < period + 1) return 50;

        let gains = 0;
        let losses = 0;

        for (let i = prices.length - period; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }

        const avgGain = gains / period;
        const avgLoss = losses / period || 0;

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    calculateMACD(prices) {
        if (!prices || prices.length === 0) return 0;
        const ema12 = this.calculateEMA(prices, 12);
        const ema26 = this.calculateEMA(prices, 26);
        return ema12 - ema26;
    }

    calculateVolatility(prices, period = 20) {
        if (!prices || prices.length < 2) return 0;

        const slice = prices.length >= period ? prices.slice(-period) : prices;
        const len = slice.length;
        const mean = slice.reduce((a, b) => a + b, 0) / len;
        const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / len;
        return Math.sqrt(variance);
    }

    // ----- Utilities -----

    normalize(data, min, max) {
        // Guard against zero or tiny ranges
        if (max === min || !isFinite(min) || !isFinite(max)) {
            return 0.5;
        }
        const range = max - min;
        if (range < 1e-6) return 0.5;
        return (data - min) / range;
    }

    buildFeatureVector(price, indicators, minPrice, maxPrice, maxVolatilityRef) {
        // indicators is always an object (never null) due to calculateIndicators
        return [
            this.normalize(price, minPrice, maxPrice),
            this.normalize(indicators.sma5, minPrice, maxPrice),
            this.normalize(indicators.sma10, minPrice, maxPrice),
            this.normalize(indicators.rsi, 0, 100),
            this.normalize(indicators.macd, -10, 10),
            this.normalize(indicators.ema12, minPrice, maxPrice),
            this.normalize(indicators.ema26, minPrice, maxPrice),
            this.normalize(indicators.volatility, 0, maxVolatilityRef)
        ];
    }

    // Clear cache for a specific ticker
    clearPredictionCache(ticker) {
        if (this.predictionCache.has(ticker)) {
            this.predictionCache.delete(ticker);
            console.log(`Cleared prediction cache for ${ticker}`);
        }
    }

    // ----- Model Creation & Training -----

    async createModel() {
        if (!window.tf) {
            console.error('TensorFlow.js not loaded');
            return;
        }

        const model = tf.sequential();

        model.add(tf.layers.lstm({
            units: 64,
            returnSequences: true,
            inputShape: [this.sequenceLength, this.featureCount]
        }));

        model.add(tf.layers.dropout({ rate: 0.2 }));

        model.add(tf.layers.lstm({
            units: 32,
            returnSequences: false
        }));

        model.add(tf.layers.dropout({ rate: 0.2 }));

        model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
        model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'meanSquaredError',
            metrics: ['mae']
        });

        this.model = model;
        return model;
    }

    async trainModel(historicalPrices, epochs = 50) {
        try {
            console.log('Preparing training data...');

            if (!historicalPrices || historicalPrices.length < this.sequenceLength + 20) {
                return { success: false, error: 'Insufficient training data' };
            }

            if (!this.model) {
                await this.createModel();
            }

            const sequences = [];
            const targets = [];

            for (let i = this.sequenceLength; i < historicalPrices.length; i++) {
                const priceWindow = historicalPrices.slice(i - this.sequenceLength, i);
                const minPrice = Math.min(...priceWindow);
                const maxPrice = Math.max(...priceWindow);

                // Skip completely flat windows to avoid bad normalization
                if (maxPrice - minPrice < 0.01) continue;

                const maxVolatilityRef = maxPrice * 0.1;

                const sequence = priceWindow.map((price, idx) => {
                    const windowForIndicators = priceWindow.slice(0, idx + 1);
                    const ind = this.calculateIndicators(windowForIndicators);
                    return this.buildFeatureVector(price, ind, minPrice, maxPrice, maxVolatilityRef);
                });

                const targetPrice = historicalPrices[i];
                const normalizedTarget = this.normalize(targetPrice, minPrice, maxPrice);

                sequences.push(sequence);
                targets.push(normalizedTarget);
            }

            if (sequences.length < 10) {
                return { success: false, error: 'Insufficient valid sequences' };
            }

            console.log(`Training with ${sequences.length} samples...`);

            const xs = tf.tensor3d(sequences);
            const ys = tf.tensor2d(targets, [targets.length, 1]);

            const history = await this.model.fit(xs, ys, {
                epochs: epochs,
                batchSize: 32,
                validationSplit: 0.2,
                shuffle: true,
                verbose: 0,
                callbacks: {
                    onEpochEnd: (epoch, logs) => {
                        if (epoch % 10 === 0) {
                            console.log(
                                `Epoch ${epoch}: loss = ${logs.loss.toFixed(4)}, mae = ${logs.mae.toFixed(4)}`
                            );
                        }
                    }
                }
            });

            xs.dispose();
            ys.dispose();

            this.isModelReady = true;
            console.log('Model training complete!');

            return {
                success: true,
                finalLoss: history.history.loss[history.history.loss.length - 1],
                finalMAE: history.history.mae[history.history.mae.length - 1]
            };

        } catch (error) {
            console.error('Training error:', error);
            this.isModelReady = false;
            return { success: false, error: error.message };
        }
    }

    // ----- Prediction (Improved) -----

    async predict(historicalPrices, ticker = '') {
        try {
            // Cache check
            if (ticker && this.predictionCache.has(ticker)) {
                const cached = this.predictionCache.get(ticker);
                if (Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
                    return cached.result;
                }
            }

            // Very low data: just return a trivial prediction
            if (!historicalPrices || historicalPrices.length === 0) {
                console.warn(`No price data for ${ticker}`);
                return null;
            }

            if (historicalPrices.length < 10) {
                console.log(`Insufficient data for ${ticker}, using statistical method`);
                return this.fallbackPredict(historicalPrices);
            }

            // ML path if model is ready and we have enough data
            if (this.model && this.isModelReady && historicalPrices.length >= this.sequenceLength) {
                try {
                    const priceWindow = historicalPrices.slice(-this.sequenceLength);
                    const minPrice = Math.min(...priceWindow);
                    const maxPrice = Math.max(...priceWindow);

                    if (maxPrice - minPrice < 0.01) {
                        console.log(`Price range too small for ${ticker}, using statistical method`);
                        return this.fallbackPredict(historicalPrices);
                    }

                    const maxVolatilityRef = maxPrice * 0.1;

                    const sequence = priceWindow.map((price, idx) => {
                        const windowForIndicators = priceWindow.slice(0, idx + 1);
                        const indicators = this.calculateIndicators(windowForIndicators);
                        return this.buildFeatureVector(price, indicators, minPrice, maxPrice, maxVolatilityRef);
                    });

                    const inputTensor = tf.tensor3d([sequence]);
                    const prediction = this.model.predict(inputTensor);
                    const normalizedPrediction = await prediction.data();

                    const predictedPrice =
                        normalizedPrediction[0] * (maxPrice - minPrice) + minPrice;

                    inputTensor.dispose();
                    prediction.dispose();

                    const currentPrice = historicalPrices[historicalPrices.length - 1];
                    const indicators = this.calculateIndicators(historicalPrices);
                    const volatility = indicators.volatility;

                    const priceDiff = Math.abs(predictedPrice - currentPrice);
                    const volatilityRatio = currentPrice ? volatility / currentPrice : 0;
                    let confidence = Math.max(60, Math.min(95, 85 - (volatilityRatio * 1000)));

                    // Reduce confidence for extreme moves (>10%)
                    if (priceDiff > currentPrice * 0.1) {
                        confidence *= 0.8;
                    }

                    const result = {
                        predictedPrice,
                        confidence: Math.round(confidence * 10) / 10,
                        direction: predictedPrice > currentPrice ? 'up' : 'down',
                        volatility,
                        indicators,
                        method: 'ml-lstm'
                    };

                    if (ticker) {
                        this.predictionCache.set(ticker, {
                            result,
                            timestamp: Date.now()
                        });
                    }

                    return result;
                } catch (mlError) {
                    console.warn(`ML prediction failed for ${ticker}:`, mlError.message);
                    // Fall through to statistical method
                }
            }

            // Statistical fallback
            return this.fallbackPredict(historicalPrices);

        } catch (error) {
            console.error(`Prediction error for ${ticker}:`, error);
            return this.fallbackPredict(historicalPrices);
        }
    }

    // ----- Statistical Fallback -----

    fallbackPredict(prices) {
        if (!prices || prices.length === 0) {
            return null;
        }

        const currentPrice = prices[prices.length - 1];

        // For very short series, just echo current price
        if (prices.length < 5) {
            return {
                predictedPrice: currentPrice,
                confidence: 50,
                direction: 'flat',
                volatility: 0,
                indicators: this.calculateIndicators(prices),
                method: 'statistical-minimal'
            };
        }

        const indicators = this.calculateIndicators(prices);
        const recent = prices.slice(-10);
        const firstRecent = recent[0];
        const lastRecent = recent[recent.length - 1];

        const trend = lastRecent - firstRecent;
        const recentTail = recent.slice(-3);
        const recentHead = recent.slice(0, 3);

        const momentum =
            recentTail.reduce((a, b) => a + b, 0) / recentTail.length -
            recentHead.reduce((a, b) => a + b, 0) / recentHead.length;

        let prediction = currentPrice;
        prediction += trend * 0.3;
        prediction += momentum * 0.2;

        if (indicators) {
            if (indicators.rsi > 70) prediction -= currentPrice * 0.02;
            else if (indicators.rsi < 30) prediction += currentPrice * 0.02;

            prediction += indicators.macd * 0.1;
        }

        const volatility = indicators ? indicators.volatility : 0;
        const volRatio = currentPrice ? volatility / currentPrice : 0;
        const confidence = Math.max(50, Math.min(85, 70 - volRatio * 100));

        return {
            predictedPrice: prediction,
            confidence: Math.round(confidence * 10) / 10,
            direction:
                prediction > currentPrice
                    ? 'up'
                    : prediction < currentPrice
                    ? 'down'
                    : 'flat',
            volatility,
            indicators,
            method: 'statistical'
        };
    }

    // ----- Persistence -----

    async saveModel(modelName = 'stock-predictor') {
        if (!this.model) return false;

        try {
            await this.model.save(`indexeddb://${modelName}`);
            console.log('Model saved successfully');
            return true;
        } catch (error) {
            console.error('Error saving model:', error);
            return false;
        }
    }

    async loadModel(modelName = 'stock-predictor') {
        try {
            this.model = await tf.loadLayersModel(`indexeddb://${modelName}`);
            this.isModelReady = true;
            console.log('Model loaded successfully');
            return true;
        } catch (error) {
            console.warn('Could not load saved model:', error);
            this.isModelReady = false;
            return false;
        }
    }
}

window.MLStockPredictor = MLStockPredictor;
