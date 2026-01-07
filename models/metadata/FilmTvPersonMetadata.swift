import Foundation

struct FilmTvPersonMetadata: Codable, Equatable {
	let name: String?
	let role: String?
	let knownFor: String?
	let imageURL: String?
	let imdbID: String?
	let imdbURL: URL?
	let tmdbID: String?
	let tmdbURL: URL?
	let ranking: Int?
	
	init(
		name: String? = nil,
		role: String? = nil,
		knownFor: String? = nil,
		imageURL: String? = nil,
		imdbID: String? = nil,
		imdbURL: URL? = nil,
		tmdbID: String? = nil,
		tmdbURL: URL? = nil,
		ranking: Int? = nil
	) {
		self.name = name
		self.role = role
		self.knownFor = knownFor
		self.imageURL = imageURL
		self.imdbID = imdbID
		self.imdbURL = imdbURL
		self.tmdbID = tmdbID
		self.tmdbURL = tmdbURL
		self.ranking = ranking
	}
	
	// ─────────── Section Header ───────────
	// Lenient Codable decoding (accept Int or String for tmdbID; coerce URLs from String)
	private enum CodingKeys: String, CodingKey {
		case name, role, knownFor, imageURL, imdbID, imdbURL, tmdbID, tmdbURL, ranking
	}
	
	init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		self.name      = try c.decodeIfPresent(String.self, forKey: .name)
		self.role      = try c.decodeIfPresent(String.self, forKey: .role)
		self.knownFor  = try c.decodeIfPresent(String.self, forKey: .knownFor)
		self.imageURL  = try c.decodeIfPresent(String.self, forKey: .imageURL)
		self.imdbID    = try c.decodeIfPresent(String.self, forKey: .imdbID)
		
		if let imdbURLString = try c.decodeIfPresent(String.self, forKey: .imdbURL) {
			self.imdbURL = URL(string: imdbURLString)
		} else {
			self.imdbURL = nil
		}
		
		if let tmdbIDString = try c.decodeIfPresent(String.self, forKey: .tmdbID) {
			self.tmdbID = tmdbIDString
		} else if let tmdbIDInt = try c.decodeIfPresent(Int.self, forKey: .tmdbID) {
			self.tmdbID = String(tmdbIDInt)
		} else {
			self.tmdbID = nil
		}
		
		if let tmdbURLString = try c.decodeIfPresent(String.self, forKey: .tmdbURL) {
			self.tmdbURL = URL(string: tmdbURLString)
		} else {
			self.tmdbURL = nil
		}
		
		self.ranking = try c.decodeIfPresent(Int.self, forKey: .ranking)
	}
	
	// ─────────── Section Header ───────────
	// Legacy dictionary initializer (still used elsewhere)
	init(fromJson json: [String: Any]) {
		self.name = json["name"] as? String
		self.role = json["role"] as? String
		self.knownFor = json["knownFor"] as? String
		self.imageURL = json["imageURL"] as? String
		self.imdbID = json["imdbID"] as? String
		
		if let imdbURLString = json["imdbURL"] as? String {
			self.imdbURL = URL(string: imdbURLString)
		} else {
			self.imdbURL = nil
		}
		
		if let tmdbRaw = json["tmdbID"] {
			if let s = tmdbRaw as? String {
				self.tmdbID = s
			} else if let i = tmdbRaw as? Int {
				self.tmdbID = String(i)
			} else {
				self.tmdbID = nil
			}
		} else {
			self.tmdbID = nil
		}
		
		if let tmdbURLString = json["tmdbURL"] as? String {
			self.tmdbURL = URL(string: tmdbURLString)
		} else {
			self.tmdbURL = nil
		}
		
		self.ranking = json["ranking"] as? Int
	}
}
