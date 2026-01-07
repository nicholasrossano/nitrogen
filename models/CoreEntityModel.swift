import Foundation

struct CoreEntity: Codable, Equatable {
	// — universal —
	let type:        String?
	let subtype:     String?
	let name:        String?
	let title:       String?
	let genre:       String?
	let album:       String?
	let song:        String?
	let party:       String?
	let position:    String?
	let locale:      String?
	let team:        String?
	let sport:        String?
	let league:      String?
	let division:    String?
	let ticker:      String?
	let ownership:   String?
	let director:    String?
	let countries:   [String]?
	let city:        String?
	let stateRegion: String?
	let address:     String?
	let date:        String?
	let time:        String?
	let awards:      [String]?
	
	// — geo —
	let lat: Double?
	let lon: Double?
	
	// — research —
	let authors:         [String]?
	let doi:             String?
	let url:             String?
	let journal:         String?
	let publicationDate: String?
	let license:         String?
	
	init(fromJson json: [String: Any]) {
		// universal
		self.type        = json["type"] as? String
		self.subtype     = json["subtype"] as? String
		self.name        = json["name"] as? String
		self.title       = json["title"] as? String
		self.genre       = json["genre"] as? String
		self.album       = json["album"] as? String
		self.song        = json["song"] as? String
		self.party       = json["party"] as? String
		self.position    = json["position"] as? String
		self.locale      = json["locale"] as? String
		self.team        = json["team"] as? String
		self.sport        = json["sport"] as? String
		self.league      = json["league"] as? String
		self.division    = json["division"] as? String
		self.ticker      = json["ticker"] as? String
		self.ownership   = json["ownership"] as? String
		self.director    = json["director"] as? String
		self.countries   = json["countries"] as? [String]
		self.city        = json["city"] as? String
		self.stateRegion = json["stateRegion"] as? String
		self.address     = json["address"] as? String
		self.date        = json["date"] as? String
		self.time        = json["time"] as? String
		self.awards      = json["awards"] as? [String]
		
		// geo
		self.lat = (json["lat"] as? NSNumber)?.doubleValue
		self.lon = (json["lon"] as? NSNumber)?.doubleValue
		
		// research
		self.authors         = json["authors"] as? [String]
		self.doi             = json["doi"] as? String
		self.url             = json["url"] as? String
		self.journal         = json["journal"] as? String
		self.publicationDate = json["publicationDate"] as? String
		self.license         = json["license"] as? String
	}
}
