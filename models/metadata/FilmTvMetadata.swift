import Foundation

struct FilmTvMetadata: Codable, Equatable {
	let title: String?
	let year: String?
	let rated: String?
	let released: String?
	let runtime: String?
	let genre: String?
	let director: String?
	let writer: String?
	let actors: String?
	let plot: String?
	let language: String?
	let country: String?
	let awards: String?
	let poster: String?
	let ratings: [Rating]?
	let imdbRating: String?
	let imdbID: String?
	let type: String?
	let trailerURL: String?
	let imdbURL: URL?
	let seasonData: SeasonData?
	
	// NEW
	let status: String?
	let releaseStatus: String?
	let isStreamingUS: Bool?
	let watchProvidersUS: WatchProvidersCountry?
	let cast: [CastMember]?
	
	// NEW
	let videoPosterURL: URL?
	
	struct Rating: Codable, Equatable {
		let source: String?
		let value: String?
		
		enum CodingKeys: String, CodingKey {
			case source = "Source"
			case value = "Value"
		}
	}
	
	struct SeasonData: Codable, Equatable {
		let title: String?
		let season: String?
		let totalSeasons: String?
		let episodes: [EpisodeData]?
	}
	
	struct EpisodeData: Codable, Equatable {
		let episode: String?
		let title: String?
		let released: String?
		let imdbRating: String?
		let imdbID: String?
	}
	
	// ─────────── Section Header ───────────
	struct WatchProvider: Codable, Equatable {
		let providerId: Int?
		let providerName: String?
		let logoURL: String?
	}
	
	struct WatchProvidersCountry: Codable, Equatable {
		let link: URL?
		let flatrate: [WatchProvider]?
		let rent: [WatchProvider]?
		let buy: [WatchProvider]?
		let ads: [WatchProvider]?
		let free: [WatchProvider]?
	}
	
	struct CastMember: Codable, Equatable {
		let name: String?
		let character: String?
		let order: Int?
	}
	
	init(
		title: String? = nil,
		year: String? = nil,
		rated: String? = nil,
		released: String? = nil,
		runtime: String? = nil,
		genre: String? = nil,
		director: String? = nil,
		writer: String? = nil,
		actors: String? = nil,
		plot: String? = nil,
		language: String? = nil,
		country: String? = nil,
		awards: String? = nil,
		poster: String? = nil,
		ratings: [Rating]? = nil,
		imdbRating: String? = nil,
		imdbID: String? = nil,
		type: String? = nil,
		trailerURL: String? = nil,
		imdbURL: URL? = nil,
		seasonData: SeasonData? = nil,
		status: String? = nil,
		releaseStatus: String? = nil,
		isStreamingUS: Bool? = nil,
		watchProvidersUS: WatchProvidersCountry? = nil,
		cast: [CastMember]? = nil,
		videoPosterURL: URL? = nil
	) {
		self.title = title
		self.year = year
		self.rated = rated
		self.released = released
		self.runtime = runtime
		self.genre = genre
		self.director = director
		self.writer = writer
		self.actors = actors
		self.plot = plot
		self.language = language
		self.country = country
		self.awards = awards
		self.poster = poster
		self.ratings = ratings
		self.imdbRating = imdbRating
		self.imdbID = imdbID
		self.type = type
		self.trailerURL = trailerURL
		self.imdbURL = imdbURL
		self.seasonData = seasonData
		self.status = status
		self.releaseStatus = releaseStatus
		self.isStreamingUS = isStreamingUS
		self.watchProvidersUS = watchProvidersUS
		self.cast = cast
		self.videoPosterURL = videoPosterURL
	}
	
	init(fromJson json: [String: Any]) {
		self.title = json["title"] as? String
		self.year = json["year"] as? String
		self.rated = json["rated"] as? String
		self.released = json["released"] as? String
		self.runtime = json["runtime"] as? String
		self.genre = json["genre"] as? String
		self.director = json["director"] as? String
		self.writer = json["writer"] as? String
		self.actors = json["actors"] as? String
		self.plot = json["plot"] as? String
		self.language = json["language"] as? String
		self.country = json["country"] as? String
		self.awards = json["awards"] as? String
		self.poster = json["poster"] as? String
		
		if let ratingsArray = json["ratings"] as? [[String: Any]] {
			self.ratings = ratingsArray.map {
				Rating(
					source: $0["Source"] as? String,
					value: $0["Value"] as? String
				)
			}
		} else {
			self.ratings = nil
		}
		
		self.imdbRating = json["imdbRating"] as? String
		self.imdbID = json["imdbID"] as? String
		self.type = json["type"] as? String
		self.trailerURL = json["trailerURL"] as? String
		
		if let imdbURLString = json["imdbURL"] as? String {
			self.imdbURL = URL(string: imdbURLString)
		} else {
			self.imdbURL = nil
		}
		
		if let seasonDict = json["seasonData"] as? [String: Any] {
			self.seasonData = SeasonData(fromJson: seasonDict)
		} else {
			self.seasonData = nil
		}
		
		// NEW
		self.status = json["status"] as? String
		self.releaseStatus = json["releaseStatus"] as? String
		self.isStreamingUS = json["isStreamingUS"] as? Bool
		
		if let wp = json["watchProvidersUS"] as? [String: Any] {
			self.watchProvidersUS = WatchProvidersCountry(fromJson: wp)
		} else {
			self.watchProvidersUS = nil
		}
		
		if let castArr = json["cast"] as? [[String: Any]] {
			self.cast = castArr.map { CastMember(fromJson: $0) }
		} else {
			self.cast = nil
		}
		
		if let s = json["videoPosterURL"] as? String {
			self.videoPosterURL = URL(string: s)
		} else {
			self.videoPosterURL = nil
		}
	}
}

// ─────────── Section Header ───────────
extension FilmTvMetadata.SeasonData {
	init(fromJson json: [String: Any]) {
		self.title = json["title"] as? String
		self.season = json["season"] as? String
		self.totalSeasons = json["totalSeasons"] as? String
		
		if let episodesArray = json["episodes"] as? [[String: Any]] {
			self.episodes = episodesArray.map { FilmTvMetadata.EpisodeData(fromJson: $0) }
		} else {
			self.episodes = nil
		}
	}
}

extension FilmTvMetadata.EpisodeData {
	init(fromJson json: [String: Any]) {
		self.episode = json["episode"] as? String
		self.title = json["title"] as? String
		self.released = json["released"] as? String
		self.imdbRating = json["imdbRating"] as? String
		self.imdbID = json["imdbID"] as? String
	}
}

// ─────────── Section Header ───────────
extension FilmTvMetadata.WatchProvidersCountry {
	init(fromJson json: [String: Any]) {
		if let linkString = json["link"] as? String {
			self.link = URL(string: linkString)
		} else {
			self.link = nil
		}
		
		func decodeList(_ key: String) -> [FilmTvMetadata.WatchProvider]? {
			guard let arr = json[key] as? [[String: Any]] else { return nil }
			return arr.map {
				FilmTvMetadata.WatchProvider(
					providerId: $0["providerId"] as? Int,
					providerName: $0["providerName"] as? String,
					logoURL: $0["logoURL"] as? String
				)
			}
		}
		
		self.flatrate = decodeList("flatrate")
		self.rent = decodeList("rent")
		self.buy = decodeList("buy")
		self.ads = decodeList("ads")
		self.free = decodeList("free")
	}
}

extension FilmTvMetadata.CastMember {
	init(fromJson json: [String: Any]) {
		self.name = json["name"] as? String
		self.character = json["character"] as? String
		self.order = json["order"] as? Int
	}
}
