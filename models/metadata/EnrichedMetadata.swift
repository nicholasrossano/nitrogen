import Foundation

struct DomainTag: Codable, Equatable {
	let id: String?
	let name: String?
	let categories: [String]?
	
	init(
		id: String? = nil,
		name: String? = nil,
		categories: [String]? = nil
	) {
		self.id = id
		self.name = name
		self.categories = categories
	}
	
	init(fromJson json: [String: Any]) {
		self.id = json["id"] as? String
		self.name = json["name"] as? String
		
		if let arr = json["categories"] as? [String] {
			self.categories = arr
		} else if let arr = json["categoryIds"] as? [String] {
			self.categories = arr
		} else {
			self.categories = nil
		}
	}
	
	func toJson() -> [String: Any] {
		var json: [String: Any] = [:]
		if let id { json["id"] = id }
		if let name { json["name"] = name }
		if let categories, !categories.isEmpty {
			json["categories"] = categories
		}
		return json
	}
}

struct ArticleImage: Codable, Equatable {
	let imageUrl: String?
	let sourceUrl: String?
	let sourceName: String?
	let caption: String?
	let width: Int?
	let height: Int?
	
	init(
		imageUrl: String? = nil,
		sourceUrl: String? = nil,
		sourceName: String? = nil,
		caption: String? = nil,
		width: Int? = nil,
		height: Int? = nil
	) {
		self.imageUrl = imageUrl
		self.sourceUrl = sourceUrl
		self.sourceName = sourceName
		self.caption = caption
		self.width = width
		self.height = height
	}
	
	init(fromJson json: [String: Any]) {
		self.imageUrl = (json["imageUrl"] as? String) ?? (json["url"] as? String)
		self.sourceUrl = (json["sourceUrl"] as? String) ?? (json["source_url"] as? String)
		
		if let nameStr = json["sourceName"] as? String {
			self.sourceName = nameStr
		} else if let dict = json["sourceName"] as? [String: Any],
				  let nested = dict["name"] as? String {
			self.sourceName = nested
		} else if let nameStr = json["source_name"] as? String {
			self.sourceName = nameStr
		} else {
			self.sourceName = nil
		}
		
		self.caption = (json["caption"] as? String) ?? (json["alt"] as? String)
		self.width = json["width"] as? Int
		self.height = json["height"] as? Int
	}
	
	func toJson() -> [String: Any] {
		var json: [String: Any] = [:]
		if let imageUrl { json["imageUrl"] = imageUrl }
		if let sourceUrl { json["sourceUrl"] = sourceUrl }
		if let sourceName { json["sourceName"] = sourceName }
		if let caption { json["caption"] = caption }
		if let width { json["width"] = width }
		if let height { json["height"] = height }
		return json
	}
}

struct EnrichedMetadata: Codable, Equatable {
	let coreEntity: CoreEntity?
	let restaurantMetadata: RestaurantMetadata?
	let musicMetadata: MusicMetadata?
	let filmTvMetadata: FilmTvMetadata?
	let stockMetadata: StockMetadata?
	let bookMetadata: BookMetadata?
	let politicianMetadata: PoliticianMetadata?
	let athleteMetadata: AthleteMetadata?
	let teamMetadata: TeamMetadata?
	let filmTvPerson: FilmTvPersonMetadata?
	let personMetadata: PersonMetadata?
	let researchMetadata: ResearchMetadata?
	
	let generatedArtURL: String?
	let generatedArtPrompt: String?
	let generatedArtSize: GeneratedArtSize?
	let generatedArtAt: Date?
	let genArtwork: GenArtwork?
	
	let domain: DomainTag?
	let articleImages: [ArticleImage]?
	let heroImageIndex: Int?
	
	struct GeneratedArtSize: Codable, Equatable {
		let w: Int?
		let h: Int?
		
		init(w: Int? = nil, h: Int? = nil) {
			self.w = w
			self.h = h
		}
		
		init(fromJson json: [String: Any]) {
			self.w = json["w"] as? Int
			self.h = json["h"] as? Int
		}
	}
	
	struct GenArtwork: Codable, Equatable {
		let url: String?
		let prompt: String?
		let size: GeneratedArtSize?
		let at: Date?
		
		init(url: String? = nil, prompt: String? = nil, size: GeneratedArtSize? = nil, at: Date? = nil) {
			self.url = url
			self.prompt = prompt
			self.size = size
			self.at = at
		}
		
		init(fromJson json: [String: Any]) {
			let urlStr = json["url"] as? String
			let promptStr = json["prompt"] as? String
			let sizeObj: GeneratedArtSize? = {
				if let s = json["size"] as? [String: Any] { return GeneratedArtSize(fromJson: s) }
				return nil
			}()
			let atDate: Date? = {
				if let ts = json["at"] as? [String: Any],
				   let secs = (ts["_seconds"] as? NSNumber)?.doubleValue {
					return Date(timeIntervalSince1970: secs)
				} else if let iso = json["at"] as? String {
					return ISO8601DateFormatter().date(from: iso)
				}
				return nil
			}()
			self.init(url: urlStr, prompt: promptStr, size: sizeObj, at: atDate)
		}
	}
	
	init(
		coreEntity: CoreEntity? = nil,
		restaurantMetadata: RestaurantMetadata? = nil,
		musicMetadata: MusicMetadata? = nil,
		filmTvMetadata: FilmTvMetadata? = nil,
		stockMetadata: StockMetadata? = nil,
		bookMetadata: BookMetadata? = nil,
		politicianMetadata: PoliticianMetadata? = nil,
		athleteMetadata: AthleteMetadata? = nil,
		teamMetadata: TeamMetadata? = nil,
		filmTvPerson: FilmTvPersonMetadata? = nil,
		personMetadata: PersonMetadata? = nil,
		researchMetadata: ResearchMetadata? = nil,
		generatedArtURL: String? = nil,
		generatedArtPrompt: String? = nil,
		generatedArtSize: GeneratedArtSize? = nil,
		generatedArtAt: Date? = nil,
		genArtwork: GenArtwork? = nil,
		domain: DomainTag? = nil,
		articleImages: [ArticleImage]? = nil,
		heroImageIndex: Int? = nil
	) {
		self.coreEntity = coreEntity
		self.restaurantMetadata = restaurantMetadata
		self.musicMetadata = musicMetadata
		self.filmTvMetadata = filmTvMetadata
		self.stockMetadata = stockMetadata
		self.bookMetadata = bookMetadata
		self.politicianMetadata = politicianMetadata
		self.athleteMetadata = athleteMetadata
		self.teamMetadata = teamMetadata
		self.filmTvPerson = filmTvPerson
		self.personMetadata = personMetadata
		self.researchMetadata = researchMetadata
		self.domain = domain
		self.articleImages = articleImages
		self.heroImageIndex = heroImageIndex
		
		let unifiedURL = generatedArtURL ?? genArtwork?.url
		let unifiedPrompt = generatedArtPrompt ?? genArtwork?.prompt
		let unifiedSize = generatedArtSize ?? genArtwork?.size
		let unifiedAt = generatedArtAt ?? genArtwork?.at
		
		self.generatedArtURL = unifiedURL
		self.generatedArtPrompt = unifiedPrompt
		self.generatedArtSize = unifiedSize
		self.generatedArtAt = unifiedAt
		
		if genArtwork != nil {
			self.genArtwork = GenArtwork(url: unifiedURL, prompt: unifiedPrompt, size: unifiedSize, at: unifiedAt)
		} else if unifiedURL != nil || unifiedPrompt != nil || unifiedSize != nil || unifiedAt != nil {
			self.genArtwork = GenArtwork(url: unifiedURL, prompt: unifiedPrompt, size: unifiedSize, at: unifiedAt)
		} else {
			self.genArtwork = nil
		}
	}
	
	init(fromJson json: [String: Any]) {
		if let coreDict = json["coreEntity"] as? [String: Any] {
			self.coreEntity = CoreEntity(fromJson: coreDict)
		} else { self.coreEntity = nil }
		
		if let restDict = json["restaurantMetadata"] as? [String: Any] {
			self.restaurantMetadata = RestaurantMetadata(fromJson: restDict)
		} else { self.restaurantMetadata = nil }
		
		if let musicDict = json["musicMetadata"] as? [String: Any] {
			self.musicMetadata = MusicMetadata(fromJson: musicDict)
		} else { self.musicMetadata = nil }
		
		if let filmTvDict = json["filmTvMetadata"] as? [String: Any] {
			self.filmTvMetadata = FilmTvMetadata(fromJson: filmTvDict)
		} else { self.filmTvMetadata = nil }
		
		if let stockDict = json["stockMetadata"] as? [String: Any] {
			self.stockMetadata = StockMetadata(fromJson: stockDict)
		} else if let stockDict = json["stock_metadata"] as? [String: Any] {
			self.stockMetadata = StockMetadata(fromJson: stockDict)
		} else { self.stockMetadata = nil }
		
		if let bookDict = json["bookMetadata"] as? [String: Any] {
			if let data = try? JSONSerialization.data(withJSONObject: bookDict),
			   let decoded = try? JSONDecoder().decode(BookMetadata.self, from: data) {
				self.bookMetadata = decoded
			} else { self.bookMetadata = nil }
		} else { self.bookMetadata = nil }
		
		if let polDict = json["politicianMetadata"] as? [String: Any] {
			self.politicianMetadata = PoliticianMetadata(fromJson: polDict)
		} else { self.politicianMetadata = nil }
		
		if let athDict = json["athleteMetadata"] as? [String: Any] {
			self.athleteMetadata = AthleteMetadata(fromJson: athDict)
		} else { self.athleteMetadata = nil }
		
		if let teamDict = json["teamMetadata"] as? [String: Any] {
			self.teamMetadata = TeamMetadata(fromJson: teamDict)
		} else { self.teamMetadata = nil }
		
		if let ftvPersonDict = json["filmTvPerson"] as? [String: Any] {
			self.filmTvPerson = FilmTvPersonMetadata(fromJson: ftvPersonDict)
		} else { self.filmTvPerson = nil }
		
		if let personDict = json["personMetadata"] as? [String: Any] {
			self.personMetadata = PersonMetadata(fromJson: personDict)
		} else { self.personMetadata = nil }
		
		if let researchDict = json["researchMetadata"] as? [String: Any] {
			if let data = try? JSONSerialization.data(withJSONObject: researchDict),
			   let decoded = try? JSONDecoder().decode(ResearchMetadata.self, from: data) {
				self.researchMetadata = decoded
			} else { self.researchMetadata = nil }
		} else { self.researchMetadata = nil }
		
		if let domainDict = json["domain"] as? [String: Any] {
			self.domain = DomainTag(fromJson: domainDict)
		} else {
			self.domain = nil
		}
		
		if let imgArr = json["articleImages"] as? [[String: Any]] {
			self.articleImages = imgArr.map { ArticleImage(fromJson: $0) }
		} else {
			self.articleImages = nil
		}
		
		if let idx = json["heroImageIndex"] as? Int {
			self.heroImageIndex = idx
		} else if let idx = json["hero_image_index"] as? Int {
			self.heroImageIndex = idx
		} else {
			self.heroImageIndex = nil
		}
		
		let nestedGA: GenArtwork? = {
			if let ga = json["genArtwork"] as? [String: Any] { return GenArtwork(fromJson: ga) }
			return nil
		}()
		
		let flatURL = json["generatedArtURL"] as? String
		let flatPrompt = json["generatedArtPrompt"] as? String
		let flatSize: GeneratedArtSize? = {
			if let sizeDict = json["generatedArtSize"] as? [String: Any] { return GeneratedArtSize(fromJson: sizeDict) }
			return nil
		}()
		let flatAt: Date? = {
			if let ts = json["generatedArtAt"] as? [String: Any],
			   let secs = (ts["_seconds"] as? NSNumber)?.doubleValue {
				return Date(timeIntervalSince1970: secs)
			} else if let iso = json["generatedArtAt"] as? String {
				return ISO8601DateFormatter().date(from: iso)
			}
			return nil
		}()
		
		let unifiedURL = flatURL ?? nestedGA?.url
		let unifiedPrompt = flatPrompt ?? nestedGA?.prompt
		let unifiedSize = flatSize ?? nestedGA?.size
		let unifiedAt = flatAt ?? nestedGA?.at
		
		self.generatedArtURL = unifiedURL
		self.generatedArtPrompt = unifiedPrompt
		self.generatedArtSize = unifiedSize
		self.generatedArtAt = unifiedAt
		
		if let nestedGA {
			self.genArtwork = GenArtwork(url: unifiedURL, prompt: unifiedPrompt, size: unifiedSize, at: unifiedAt)
		} else if unifiedURL != nil || unifiedPrompt != nil || unifiedSize != nil || unifiedAt != nil {
			self.genArtwork = GenArtwork(url: unifiedURL, prompt: unifiedPrompt, size: unifiedSize, at: unifiedAt)
		} else {
			self.genArtwork = nil
		}
	}
}
