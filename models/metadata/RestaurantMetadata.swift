import Foundation

// ─────────── Restaurant Metadata ───────────
struct RestaurantMetadata: Codable, Hashable {
	// core
	let name:              String?
	let yelpId:            String?
	let googlePlaceId:     String?
	let yelpUrl:           String?
	
	// ratings & volume
	let reviewCountYelp:   Int?
	let userRatingsTotal:  Int?
	let ratingGoogle:      Double?
	let ratingYelp:        Double?
	
	// price & categorisation
	let priceLevel:        Int?          // 0–4 per Google
	let photos:            [String]?
	let categories:        [String]?
	
	init(
		name: String? = nil,
		yelpId: String? = nil,
		googlePlaceId: String? = nil,
		yelpUrl: String? = nil,
		reviewCountYelp: Int? = nil,
		userRatingsTotal: Int? = nil,
		ratingGoogle: Double? = nil,
		ratingYelp: Double? = nil,
		priceLevel: Int? = nil,
		photos: [String]? = nil,
		categories: [String]? = nil
	) {
		self.name             = name
		self.yelpId           = yelpId
		self.googlePlaceId    = googlePlaceId
		self.yelpUrl          = yelpUrl
		self.reviewCountYelp  = reviewCountYelp
		self.userRatingsTotal = userRatingsTotal
		self.ratingGoogle     = ratingGoogle
		self.ratingYelp       = ratingYelp
		self.priceLevel       = priceLevel
		self.photos           = photos
		self.categories       = categories
	}
	
	init(fromJson json: [String: Any]) {
		self.name             = json["name"] as? String
		self.yelpId           = json["yelpId"] as? String
		self.googlePlaceId    = json["googlePlaceId"] as? String
		self.yelpUrl          = json["yelpUrl"] as? String
		self.reviewCountYelp  = (json["reviewCountYelp"] as? NSNumber)?.intValue
		self.userRatingsTotal = (json["userRatingsTotal"] as? NSNumber)?.intValue
		self.ratingGoogle     = (json["ratingGoogle"] as? NSNumber)?.doubleValue
		self.ratingYelp       = (json["ratingYelp"] as? NSNumber)?.doubleValue
		self.priceLevel       = (json["priceLevel"] as? NSNumber)?.intValue
		self.photos           = json["photos"] as? [String]
		self.categories       = json["categories"] as? [String]
	}
}
