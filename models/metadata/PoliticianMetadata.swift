//  PoliticianMetadata.swift
//  Ponder

import Foundation

// ─────────── Model ───────────
struct PoliticianMetadata: Codable, Equatable {
	let name:        String?
	let party:       String?
	let locale:      String?
	let position:    String?
	let imageURL:    String?
	let wikidataID:  String?
	let wikipediaURL: URL?
	let officialURL: String?             // .gov site when available
	let pollSeries:  [PollPoint]?        // election or approval trend
	
	// ─────────── Nested PollPoint ───────────
	struct PollPoint: Codable, Equatable {
		let date: String?    // "YYYY-MM-DD"
		let pct:  Double?
	}
	
	// ─────────── Init helpers ───────────
	init(
		name: String? = nil,
		party: String? = nil,
		locale: String? = nil,
		position: String? = nil,
		imageURL: String? = nil,
		wikidataID: String? = nil,
		wikipediaURL: URL? = nil,
		officialURL: String? = nil,
		pollSeries: [PollPoint]? = nil
	) {
		self.name         = name
		self.party        = party
		self.locale       = locale
		self.position     = position
		self.imageURL     = imageURL
		self.wikidataID   = wikidataID
		self.wikipediaURL = wikipediaURL
		self.officialURL  = officialURL
		self.pollSeries   = pollSeries
	}
	
	// JSON init for legacy dictionaries
	init(fromJson json: [String: Any]) {
		self.name        = json["name"]        as? String
		self.party       = json["party"]       as? String
		self.locale      = json["locale"]      as? String
		self.position    = json["position"]    as? String
		self.imageURL    = json["imageURL"]    as? String
		self.wikidataID  = json["wikidataID"]  as? String
		
		if let wikiStr = json["wikipediaURL"] as? String {
			self.wikipediaURL = URL(string: wikiStr)
		} else { self.wikipediaURL = nil }
		
		self.officialURL = json["officialURL"] as? String
		
		if let arr = json["pollSeries"] as? [[String: Any]] {
			self.pollSeries = arr.compactMap {
				guard let d = $0["date"] as? String,
					  let p = $0["pct"]  as? Double else { return nil }
				return PollPoint(date: d, pct: p)
			}
		} else { self.pollSeries = nil }
	}
}
