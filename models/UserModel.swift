import Foundation
import FirebaseFirestore
import FirebaseFirestoreInternal

struct User: Identifiable, Codable {
	let id: String
	let email: String?
	var role: String?
	var favoriteTopicIds: [String]
	var onboarded: Bool
	var reviewPromptShown: Bool
	var surveyPromptShown: Bool
	var voiceStyle: String?
	
	var subscription: Subscription?
	var entitlements: [String]
	
	var locale: String?
	var timezoneOffsetMinutes: Int?
	var domainPreferences: [String: [String]]
	
	var locationLatitude: Double?
	var locationLongitude: Double?
	var locationAccuracyMeters: Double?
	var locationLocality: String?
	var locationAdministrativeArea: String?
	var locationCountryCode: String?
	var locationGeohash: String?
	var locationUpdatedAt: Date?
	
	init(
		id: String,
		email: String? = nil,
		role: String? = nil,
		favoriteTopicIds: [String] = [],
		onboarded: Bool = false,
		reviewPromptShown: Bool = false,
		surveyPromptShown: Bool = false,
		voiceStyle: String? = nil,
		subscription: Subscription? = nil,
		entitlements: [String] = [],
		locale: String? = nil,
		timezoneOffsetMinutes: Int? = nil,
		domainPreferences: [String: [String]] = [:],
		locationLatitude: Double? = nil,
		locationLongitude: Double? = nil,
		locationAccuracyMeters: Double? = nil,
		locationLocality: String? = nil,
		locationAdministrativeArea: String? = nil,
		locationCountryCode: String? = nil,
		locationGeohash: String? = nil,
		locationUpdatedAt: Date? = nil
	) {
		self.id = id
		self.email = email
		self.role = role
		self.favoriteTopicIds = favoriteTopicIds
		self.onboarded = onboarded
		self.reviewPromptShown = reviewPromptShown
		self.surveyPromptShown = surveyPromptShown
		self.voiceStyle = voiceStyle
		self.subscription = subscription
		self.entitlements = entitlements
		self.locale = locale
		self.timezoneOffsetMinutes = timezoneOffsetMinutes
		self.domainPreferences = domainPreferences
		
		self.locationLatitude = locationLatitude
		self.locationLongitude = locationLongitude
		self.locationAccuracyMeters = locationAccuracyMeters
		self.locationLocality = locationLocality
		self.locationAdministrativeArea = locationAdministrativeArea
		self.locationCountryCode = locationCountryCode
		self.locationGeohash = locationGeohash
		self.locationUpdatedAt = locationUpdatedAt
	}
	
	init(from document: DocumentSnapshot) {
		let d = document.data() ?? [:]
		
		id                = document.documentID
		email             = d["email"] as? String
		role              = d["role"]  as? String
		
		let favDomainIds = d["favoriteDomainIds"] as? [String]
		let favTopicIds  = d["favoriteTopicIds"] as? [String]
		favoriteTopicIds = favDomainIds ?? favTopicIds ?? []
		
		onboarded         = d["onboarded"] as? Bool ?? false
		reviewPromptShown = d["reviewPromptShown"] as? Bool ?? false
		surveyPromptShown = d["surveyPromptShown"] as? Bool ?? false
		voiceStyle        = d["voiceStyle"] as? String
		entitlements      = d["entitlements"] as? [String] ?? []
		locale            = d["locale"] as? String
		timezoneOffsetMinutes = d["timezoneOffsetMinutes"] as? Int
		
		locationLatitude = d["locationLatitude"] as? Double
		locationLongitude = d["locationLongitude"] as? Double
		locationAccuracyMeters = d["locationAccuracyMeters"] as? Double
		locationLocality = d["locationLocality"] as? String
		locationAdministrativeArea = d["locationAdministrativeArea"] as? String
		locationCountryCode = d["locationCountryCode"] as? String
		locationGeohash = d["locationGeohash"] as? String
		locationUpdatedAt = (d["locationUpdatedAt"] as? Timestamp)?.dateValue()
		
		if let rawPrefs = d["domainPreferences"] as? [String: Any] {
			var converted: [String: [String]] = [:]
			for (key, value) in rawPrefs {
				if let arr = value as? [String] {
					converted[key] = arr
				}
			}
			domainPreferences = converted
		} else {
			domainPreferences = [:]
		}
		
		if let sub = d["subscription"] as? [String: Any] {
			subscription = try? Firestore.Decoder().decode(Subscription.self, from: sub)
		} else {
			subscription = nil
		}
	}
	
	func toJson() -> [String: Any] {
		var json: [String: Any] = [
			"email"             : email as Any,
			"onboarded"         : onboarded,
			"reviewPromptShown" : reviewPromptShown,
			"surveyPromptShown" : surveyPromptShown,
			"entitlements"      : entitlements,
			"domainPreferences" : domainPreferences,
			
			// Backward/forward compatible favorites:
			// - New canonical key: favoriteDomainIds
			// - Old key kept temporarily: favoriteTopicIds
			"favoriteDomainIds" : favoriteTopicIds,
			"favoriteTopicIds"  : favoriteTopicIds
		]
		
		if let role { json["role"] = role }
		if let voiceStyle { json["voiceStyle"] = voiceStyle }
		if let subscription {
			json["subscription"] = try! Firestore.Encoder().encode(subscription)
		}
		if let locale { json["locale"] = locale }
		if let timezoneOffsetMinutes {
			json["timezoneOffsetMinutes"] = timezoneOffsetMinutes
		}
		
		if let locationLatitude { json["locationLatitude"] = locationLatitude }
		if let locationLongitude { json["locationLongitude"] = locationLongitude }
		if let locationAccuracyMeters { json["locationAccuracyMeters"] = locationAccuracyMeters }
		if let locationLocality { json["locationLocality"] = locationLocality }
		if let locationAdministrativeArea { json["locationAdministrativeArea"] = locationAdministrativeArea }
		if let locationCountryCode { json["locationCountryCode"] = locationCountryCode }
		if let locationGeohash { json["locationGeohash"] = locationGeohash }
		if let locationUpdatedAt { json["locationUpdatedAt"] = Timestamp(date: locationUpdatedAt) }
		
		return json
	}
}
