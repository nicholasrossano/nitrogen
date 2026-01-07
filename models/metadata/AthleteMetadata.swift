import Foundation

struct AthleteMetadata: Codable, Equatable {
	let name: String?
	let position: String?
	let team: String?
	let league: String?
	let division: String?
	let imageURL: String?
	let ranking: Int?
	let wikipediaURL: URL?
	let espnURL: URL?
	
	init(
		name: String? = nil,
		position: String? = nil,
		team: String? = nil,
		league: String? = nil,
		division: String? = nil,
		imageURL: String? = nil,
		ranking: Int? = nil,
		wikipediaURL: URL? = nil,
		espnURL: URL? = nil
	) {
		self.name = name
		self.position = position
		self.team = team
		self.league = league
		self.division = division
		self.imageURL = imageURL
		self.ranking = ranking
		self.wikipediaURL = wikipediaURL
		self.espnURL = espnURL
	}
	
	init(fromJson json: [String: Any]) {
		self.name = json["name"] as? String
		self.position = json["position"] as? String
		self.team = json["team"] as? String
		self.league = json["league"] as? String
		self.division = json["division"] as? String
		
		if let img = json["imageURL"] as? String {
			self.imageURL = img
		} else if let img2 = json["headshotURL"] as? String {
			self.imageURL = img2
		} else {
			self.imageURL = nil
		}
		
		if let r = json["ranking"] as? Int {
			self.ranking = r
		} else if let rs = json["ranking"] as? String, let ri = Int(rs) {
			self.ranking = ri
		} else {
			self.ranking = nil
		}
		
		if let wikiStr = json["wikipediaURL"] as? String {
			self.wikipediaURL = URL(string: wikiStr)
		} else { self.wikipediaURL = nil }
		
		if let espnStr = json["espnURL"] as? String {
			self.espnURL = URL(string: espnStr)
		} else { self.espnURL = nil }
	}
}
