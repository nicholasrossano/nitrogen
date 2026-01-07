// ChatMessage.swift
import Foundation
import UIKit

struct ChatMessage: Identifiable {
	let id = UUID()
	let isUser: Bool
	
	// NEW unified enriched payload used by MusicWidget/CinemaWidget
	let enrichedMetadata: EnrichedMetadata?
	
	let text       : String?
	let video      : Video?
	let image      : UIImage?
	let track      : MusicTrack?
	let movie      : Movie?
	let book       : BookMetadata?
	let restaurant : RestaurantMetadata?
	let stock      : StockMetadata?
	let politician : PoliticianMetadata?
	let athlete    : CuratorAthlete?
	let team       : CuratorTeam?
	
	// MARK: - Text
	init(text: String, isUser: Bool) {
		self.enrichedMetadata = nil
		self.text        = text
		self.video       = nil
		self.image       = nil
		self.track       = nil
		self.movie       = nil
		self.book        = nil
		self.restaurant  = nil
		self.stock       = nil
		self.politician  = nil
		self.athlete     = nil
		self.team        = nil
		self.isUser      = isUser
	}
	
	// MARK: - NEW enriched metadata constructor
	init(enrichedMetadata: EnrichedMetadata) {
		self.enrichedMetadata = enrichedMetadata
		self.text        = nil
		self.video       = nil
		self.image       = nil
		self.track       = nil
		self.movie       = nil
		self.book        = nil
		self.restaurant  = nil
		self.stock       = nil
		self.politician  = nil
		self.athlete     = nil
		self.team        = nil
		self.isUser      = false
	}
	
	init(video: Video) {
		self.enrichedMetadata = nil
		self.text        = nil
		self.video       = video
		self.image       = nil
		self.track       = nil
		self.movie       = nil
		self.book        = nil
		self.restaurant  = nil
		self.stock       = nil
		self.politician  = nil
		self.athlete     = nil
		self.team        = nil
		self.isUser      = false
	}
	
	init(image: UIImage) {
		self.enrichedMetadata = nil
		self.text        = nil
		self.video       = nil
		self.image       = image
		self.track       = nil
		self.movie       = nil
		self.book        = nil
		self.restaurant  = nil
		self.stock       = nil
		self.politician  = nil
		self.athlete     = nil
		self.team        = nil
		self.isUser      = false
	}
	
	init(track: MusicTrack) {
		self.enrichedMetadata = nil
		self.text        = nil
		self.video       = nil
		self.image       = nil
		self.track       = track
		self.movie       = nil
		self.book        = nil
		self.restaurant  = nil
		self.stock       = nil
		self.politician  = nil
		self.athlete     = nil
		self.team        = nil
		self.isUser      = false
	}
	
	init(movie: Movie) {
		self.enrichedMetadata = nil
		self.text        = nil
		self.video       = nil
		self.image       = nil
		self.track       = nil
		self.movie       = movie
		self.book        = nil
		self.restaurant  = nil
		self.stock       = nil
		self.politician  = nil
		self.athlete     = nil
		self.team        = nil
		self.isUser      = false
	}
	
	init(book: BookMetadata) {
		self.enrichedMetadata = nil
		self.text        = nil
		self.video       = nil
		self.image       = nil
		self.track       = nil
		self.movie       = nil
		self.book        = book
		self.restaurant  = nil
		self.stock       = nil
		self.politician  = nil
		self.athlete     = nil
		self.team        = nil
		self.isUser      = false
	}
	
	init(restaurant: RestaurantMetadata) {
		self.enrichedMetadata = nil
		self.text        = nil
		self.video       = nil
		self.image       = nil
		self.track       = nil
		self.movie       = nil
		self.book        = nil
		self.restaurant  = restaurant
		self.stock       = nil
		self.politician  = nil
		self.athlete     = nil
		self.team        = nil
		self.isUser      = false
	}
	
	init(stock: StockMetadata) {
		self.enrichedMetadata = nil
		self.text        = nil
		self.video       = nil
		self.image       = nil
		self.track       = nil
		self.movie       = nil
		self.book        = nil
		self.restaurant  = nil
		self.stock       = stock
		self.politician  = nil
		self.athlete     = nil
		self.team        = nil
		self.isUser      = false
	}
	
	// ─────────── Section Header ───────────
	init(politician: PoliticianMetadata) {
		self.enrichedMetadata = nil
		self.text        = nil
		self.video       = nil
		self.image       = nil
		self.track       = nil
		self.movie       = nil
		self.book        = nil
		self.restaurant  = nil
		self.stock       = nil
		self.politician  = politician
		self.athlete     = nil
		self.team        = nil
		self.isUser      = false
	}
	
	// ─────────── Section Header ───────────
	init(athlete: CuratorAthlete) {
		self.enrichedMetadata = nil
		self.text        = nil
		self.video       = nil
		self.image       = nil
		self.track       = nil
		self.movie       = nil
		self.book        = nil
		self.restaurant  = nil
		self.stock       = nil
		self.politician  = nil
		self.athlete     = athlete
		self.team        = nil
		self.isUser      = false
	}
	
	// ─────────── Section Header ───────────
	init(team: CuratorTeam) {
		self.enrichedMetadata = nil
		self.text        = nil
		self.video       = nil
		self.image       = nil
		self.track       = nil
		self.movie       = nil
		self.book        = nil
		self.restaurant  = nil
		self.stock       = nil
		self.politician  = nil
		self.athlete     = nil
		self.team        = team
		self.isUser      = false
	}
}

// ─────────── Section Header ───────────
struct CuratorTeam {
	let team: String?
	let city: String?
	let division: String?
	let league: String?
	let logoURL: URL?
	let externalURL: URL?
	let ranking: Int?
	let record: String?
}

// ─────────── Section Header ───────────
struct CuratorAthlete {
	let name: String?
	let position: String?
	let team: String?
	let league: String?
	let imageURL: URL?
	let externalURL: URL?
	let ranking: Int?
}
