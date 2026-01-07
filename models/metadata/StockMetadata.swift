import Foundation

struct StockMetadata: Codable, Equatable {
	let ticker: String?
	let dataPoints: [DataPoint]?
	let percentageChange: Double?
	let searchConfidence: Int?
	let stocksLink: String?
	
	// ─────────── Company Fallback Fields ───────────
	let companyName: String?
	let companyLogoURL: String?
	let companyIndustry: String?
	let companyURL: String?
	
	struct DataPoint: Codable, Equatable {
		let date: String
		let close: Double
	}
	
	init(
		ticker: String? = nil,
		dataPoints: [DataPoint]? = nil,
		percentageChange: Double? = nil,
		searchConfidence: Int? = nil,
		stocksLink: String? = nil,
		companyName: String? = nil,
		companyLogoURL: String? = nil,
		companyIndustry: String? = nil,
		companyURL: String? = nil
	) {
		self.ticker = ticker
		self.dataPoints = dataPoints
		self.percentageChange = percentageChange
		self.searchConfidence = searchConfidence
		self.stocksLink = stocksLink
		self.companyName = companyName
		self.companyLogoURL = companyLogoURL
		self.companyIndustry = companyIndustry
		self.companyURL = companyURL
	}
	
	init(fromJson json: [String: Any]) {
		self.ticker = json["ticker"] as? String
		self.percentageChange = json["percentageChange"] as? Double
		self.searchConfidence = json["searchConfidence"] as? Int
		self.stocksLink = json["stocksLink"] as? String
		
		// dataPoints
		if let points = json["dataPoints"] as? [[String: Any]] {
			self.dataPoints = points.compactMap { dict in
				guard
					let date = dict["date"] as? String,
					let close = dict["close"] as? Double
				else {
					return nil
				}
				return DataPoint(date: date, close: close)
			}
		} else {
			self.dataPoints = nil
		}
		
		// fallback company fields
		self.companyName = json["companyName"] as? String
		self.companyLogoURL = json["companyLogoURL"] as? String
		self.companyIndustry = json["companyIndustry"] as? String
		self.companyURL = json["companyURL"] as? String
	}
}
