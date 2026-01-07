import Foundation

struct TeamMetadata: Codable, Equatable {
	let team: String?
	let city: String?
	let region: String?
	let league: String?
	let division: String?
	let logoURL: String?
	let ranking: Int?
	let wins: Int?
	let losses: Int?
	let draws: Int?
	let wikipediaURL: URL?
	let espnURL: URL?
	
	var recordString: String? {
		guard let w = wins, let l = losses else { return nil }
		if let d = draws { return "\(w)-\(l)-\(d)" }
		return "\(w)-\(l)"
	}
	
	init(
		team: String? = nil,
		city: String? = nil,
		region: String? = nil,
		league: String? = nil,
		division: String? = nil,
		logoURL: String? = nil,
		ranking: Int? = nil,
		wins: Int? = nil,
		losses: Int? = nil,
		draws: Int? = nil,
		wikipediaURL: URL? = nil,
		espnURL: URL? = nil
	) {
		self.team = team
		self.city = city
		self.region = region
		self.league = league
		self.division = division
		self.logoURL = logoURL
		self.ranking = ranking
		self.wins = wins
		self.losses = losses
		self.draws = draws
		self.wikipediaURL = wikipediaURL
		self.espnURL = espnURL
	}
	
	init(fromJson json: [String: Any]) {
		self.team = json["team"] as? String
		self.city = json["city"] as? String
		self.region = json["region"] as? String
		self.league = json["league"] as? String
		self.division = json["division"] as? String
		self.logoURL = json["logoURL"] as? String
		
		if let r = json["ranking"] as? Int {
			self.ranking = r
		} else if let rs = json["ranking"] as? String, let ri = Int(rs) {
			self.ranking = ri
		} else {
			self.ranking = nil
		}
		
		func coerceInt(_ v: Any?) -> Int? {
			if let i = v as? Int { return i }
			if let s = v as? String, let i = Int(s) { return i }
			return nil
		}
		self.wins = coerceInt(json["wins"])
		self.losses = coerceInt(json["losses"])
		self.draws = coerceInt(json["draws"])
		
		if let wikiStr = json["wikipediaURL"] as? String {
			self.wikipediaURL = URL(string: wikiStr)
		} else { self.wikipediaURL = nil }
		
		if let espnStr = json["espnURL"] as? String {
			self.espnURL = URL(string: espnStr)
		} else { self.espnURL = nil }
	}
}
