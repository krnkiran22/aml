import React, { useState, useEffect } from "react";
import axios from "axios";

const App = () => {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [riskLevel, setRiskLevel] = useState("Calculating...");
    const [varianceRisk, setVarianceRisk] = useState("Calculating...");
    const [timeGapConsistency, setTimeGapConsistency] = useState("Calculating...");
    const [address, setAddress] = useState("");
    const [inputAddress, setInputAddress] = useState("");
    const ALCHEMY_API_KEY = "gQ3YwPsTCsqwjr1ocrnONX63jiNZKkVT";
    // const address = "0xC95380dc0277Ac927dB290234ff66880C4cdda8c";

    const alchemyUrl = `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API_KEY}`;
    const coingeckoUrl = "https://api.coingecko.com/api/v3/simple/price";

    useEffect(() => {
      if (!address) return;
      
        const fetchTransactions = async () => {
            try {
                const response = await axios.post(alchemyUrl, {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "alchemy_getAssetTransfers",
                    params: [{
                        fromBlock: "0x0",
                        toBlock: "latest",
                        fromAddress: address,
                        category: ["external", "erc20", "erc721", "erc1155"]
                    }]
                });

                const transfers = response.data.result.transfers || [];
                await processTransactions(transfers);
            } catch (error) {
                console.error("❌ Error fetching transactions:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchTransactions();
    }, [address]);

    const processTransactions = async (transfers) => {
        const txCountsByDay = {};
        const updatedTransactions = [...transfers]; 
        let stableValues = []; 

        const uniqueAssets = [...new Set(transfers.map(tx => tx.asset).filter(Boolean))];
        const exchangeRates = await fetchExchangeRates(uniqueAssets);

        for (let i = 0; i < transfers.length; i++) {
            const tx = transfers[i];

            try {
                const blockResponse = await axios.post(alchemyUrl, {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "eth_getBlockByNumber",
                    params: [tx.blockNum, true]
                });

                const timestampHex = blockResponse?.data?.result?.timestamp;
                if (!timestampHex) {
                    console.warn("❌ Missing timestamp for block:", tx.blockNum);
                    continue;
                }

                const timestamp = parseInt(timestampHex, 16) * 1000;
                const dateObj = new Date(timestamp);

                if (isNaN(dateObj.getTime())) {
                    console.warn("❌ Date conversion failed for timestamp:", timestamp);
                    continue;
                }

                const formattedDate = dateObj.toISOString().split("T")[0];

                // Convert transaction value to USD
                const asset = tx.asset;
                const tokenValue = parseFloat(tx.value) || 0;
                const usdValue = await convertToUSD(asset, tokenValue, exchangeRates);

                stableValues.push(usdValue); 
                
                updatedTransactions[i] = { 
                    ...tx, 
                    metadata: { blockTimestamp: timestamp }, 
                    usdValue 
                };

                const key = `${formattedDate}_${tx.from}_${tx.to}`;
                txCountsByDay[key] = (txCountsByDay[key] || 0) + 1;

            } catch (error) {
                console.error("❌ Error fetching block data:", error);
            }
        }

        setTransactions(updatedTransactions);
        calculateRiskLevel(txCountsByDay);
        calculateVarianceRisk(stableValues);
        analyzeTimeGapConsistency(updatedTransactions);
    };

    const fetchExchangeRates = async (assets) => {
        if (assets.length === 0) return {};

        try {
            const assetList = [...new Set(assets.map(asset => asset.toLowerCase()))];
            if (!assetList.includes("ethereum")) assetList.push("ethereum"); // Ensure ETH is included

            const response = await axios.get(coingeckoUrl, {
                params: { ids: assetList.join(","), vs_currencies: "usd" }
            });

            return response.data;
        } catch (error) {
            console.error("❌ Error fetching exchange rates:", error);
            return {};
        }
    };

    const convertToUSD = async (asset, amount, exchangeRates) => {
        if (!asset || !amount) return 0;

        let assetId = asset.toLowerCase();
        if (assetId === "eth") assetId = "ethereum"; 

        if (exchangeRates[assetId]) return amount * exchangeRates[assetId].usd;

        console.warn(`⚠️ Price unavailable for ${asset}`);
        return 0;
    };

    const calculateRiskLevel = (txCountsByDay) => {
        const maxTxPerDay = Math.max(...Object.values(txCountsByDay), 0);
        if (maxTxPerDay > 20) setRiskLevel("High Risk 🚨");
        else if (maxTxPerDay >= 5) setRiskLevel("Medium Risk ⚠️");
        else setRiskLevel("Low Risk ✅");
    };

    const calculateVarianceRisk = (values) => {
        if (values.length < 2) {
            setVarianceRisk("Insufficient data");
            return;
        }

        const mean = values.reduce((acc, val) => acc + val, 0) / values.length;
        const variance = values.map(val => Math.abs((val - mean) / mean) * 100);
        const highVarianceCount = variance.filter(v => v > 15).length;
        const mediumVarianceCount = variance.filter(v => v >= 5 && v <= 15).length;
        const totalTransactions = variance.length;

        if (highVarianceCount / totalTransactions >= 0.8) setVarianceRisk("High Risk 🚨");
        else if (mediumVarianceCount / totalTransactions >= 0.5) setVarianceRisk("Medium Risk ⚠️");
        else setVarianceRisk("Low Risk ✅");
    };

    const analyzeTimeGapConsistency = (timestamps) => {
      if (timestamps.length < 2) {
          setTimeGapConsistency("Insufficient data");
          return;
      }

      timestamps.sort((a, b) => a - b);  

      let timeGaps = [];
      for (let i = 1; i < timestamps.length; i++) {
          const gap = (timestamps[i] - timestamps[i - 1]) / 1000 / 60; 
          timeGaps.push(gap);
      }

      const avgGap = timeGaps.reduce((sum, gap) => sum + gap, 0) / timeGaps.length;
      const deviation = timeGaps.map(gap => Math.abs((gap - avgGap) / avgGap) * 100);
      
      const highDeviationCount = deviation.filter(d => d > 50).length;
      const mediumDeviationCount = deviation.filter(d => d >= 20 && d <= 50).length;
      const totalTransactions = deviation.length;

      if (highDeviationCount / totalTransactions >= 0.7) {
          setTimeGapConsistency("High Risk 🚨");
      } else if (mediumDeviationCount / totalTransactions >= 0.5) {
          setTimeGapConsistency("Medium Risk ⚠️");
      } else {
          setTimeGapConsistency("Low Risk ✅");
      }
  };
  

    return (
      <div>
      <h2>Transaction History</h2>
      <input 
                type="text" 
                placeholder="Enter wallet address" 
                value={inputAddress} 
                onChange={(e) => setInputAddress(e.target.value)} 
            />
      <button onClick={() => setAddress(inputAddress)}>Fetch Transactions</button>
      <p><strong>Transaction Frequency Risk:</strong> {riskLevel}</p>
      <p><strong>Transaction Amount Variance Risk:</strong> {varianceRisk}</p>
      <p><strong>Time Gap Consistency:</strong> {timeGapConsistency}</p>
      {loading ? <p>Loading...</p> : (
          <table border="1">
              <thead>
                  <tr>
                      <th>Date</th>
                      <th>Transaction Hash</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Value (USD)</th>
                      <th>Asset</th>
                  </tr>
              </thead>
              <tbody>
                  {transactions.map((tx, index) => (
                      <tr key={index}>
                          <td>{tx.metadata?.blockTimestamp ? new Date(tx.metadata.blockTimestamp).toISOString().split("T")[0] : "N/A"}</td>
                          <td>{tx.hash.slice(0, 10)}...</td>
                          <td>{tx.from}</td>
                          <td>{tx.to}</td>
                          <td>${tx.usdValue?.toFixed(2) || "0.00"}</td>
                          <td>{tx.asset || "Unknown"}</td>
                      </tr>
                  ))}
              </tbody>
          </table>
      )}
  </div>
    );
};

export default App;
