import Foundation

enum YahooFinanceError: Error {
    case invalidURL, network(Error), parsing(Error), noData
}

struct YahooFinanceAPI {
    private static let base = "https://query1.finance.yahoo.com"
    
    typealias Completion = (Result<StockMetadata, YahooFinanceError>) -> Void
    
    static func fetchStock(_ symbol: String, completion: @escaping Completion) {
        // Pull 30 trading days (interval 1d, range 1mo)
        let path = "/v8/finance/chart/\(symbol)"
        var comps = URLComponents(string: base + path)!
        comps.queryItems = [
            .init(name: "interval", value: "1d"),
            .init(name: "range",    value: "1mo")
        ]
        guard let url = comps.url else {
            completion(.failure(.invalidURL)); return
        }
        
        URLSession.shared.dataTask(with: url) { data, _, err in
            if let err { completion(.failure(.network(err))); return }
            guard let data else { completion(.failure(.noData)); return }
            
            do {
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                guard
                    let chart  = json?["chart"] as? [String: Any],
                    let result = (chart["result"] as? [[String: Any]])?.first,
                    let meta   = result["meta"]  as? [String: Any],
                    (meta["regularMarketPrice"] as? Double) != nil,
                    let timestamps = result["timestamp"] as? [Int],
                    let indicators = result["indicators"] as? [String: Any],
                    let quote = (indicators["quote"] as? [[String: Any]])?.first,
                    let closes = quote["close"] as? [Double]
                else { throw YahooFinanceError.parsing(NSError()) }
                
                let points = zip(timestamps, closes).compactMap { ts, c in
                    c.isNaN ? nil : StockMetadata.DataPoint(
                        date : ISO8601DateFormatter()
                            .string(from: Date(timeIntervalSince1970: TimeInterval(ts)))
                            .prefix(10)
                            .description,
                        close: c)
                }
                
                let metaOut = StockMetadata(
                    ticker          : symbol.uppercased(),
                    dataPoints      : points,
                    percentageChange: nil,
                    searchConfidence: 100,
                    stocksLink      : "https://finance.yahoo.com/quote/\(symbol)"
                )
                completion(.success(metaOut))
            } catch {
                completion(.failure(.parsing(error)))
            }
        }
        .resume()
    }
}
