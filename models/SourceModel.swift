import SwiftUI

// ─────────── Source – news source metadata ───────────
struct Source: Codable, Equatable {
	// ────────── Properties ──────────
	let name    : String?
	let headline: String?        // ← NEW
	let url     : String?
	let iconUrl : String?
	
	// ────────── Inits ──────────
	init(name: String?     = nil,
		 headline: String? = nil,
		 url: String?      = nil,
		 iconUrl: String?  = nil)
	{
		self.name     = name
		self.headline = headline
		self.url      = url
		self.iconUrl  = iconUrl
	}
	
	init(fromJson json: [String: Any]) {
		self.name     = json["name"]     as? String
		self.headline = json["headline"] as? String
		self.url      = json["url"]      as? String
		self.iconUrl  = json["iconUrl"]  as? String
	}
	
	// ────────── Serialization ──────────
	func toJson() -> [String: Any] {
		return [
			"name"    : name     as Any,
			"headline": headline as Any,
			"url"     : url      as Any,
			"iconUrl" : iconUrl  as Any
		]
	}
}
