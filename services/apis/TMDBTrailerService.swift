import Foundation

// ─────────── TMDBTrailerService ───────────
enum TMDBTrailerService {
	private static var apiKey: String {
		guard
			let path  = Bundle.main.path(forResource: "Secrets", ofType: "plist"),
			let plist = NSDictionary(contentsOfFile: path),
			let key   = plist["TMDBAPIKey"] as? String
		else { fatalError("TMDB key missing") }
		return key
	}
	
    private static let base   = "https://api.themoviedb.org/3"
    
    static func trailerURL(for imdbID: String) async throws -> URL? {
        guard !imdbID.isEmpty else { return nil }
        
        // 1. Resolve TMDB movie id
        let findURL = "\(base)/find/\(imdbID)?api_key=\(apiKey)&external_source=imdb_id"
        let (findData, _) = try await URLSession.shared.data(from: URL(string: findURL)!)
        struct FindResp: Decodable { struct Movie: Decodable { let id: Int }
            let movie_results: [Movie] }
        let tmdbId = try JSONDecoder().decode(FindResp.self, from: findData)
            .movie_results.first?.id
        guard let id = tmdbId else { return nil }
        
        // 2. Grab YouTube trailer key
        let vidsURL = "\(base)/movie/\(id)/videos?api_key=\(apiKey)"
        let (vidData, _) = try await URLSession.shared.data(from: URL(string: vidsURL)!)
        struct VidsResp: Decodable { struct Vid: Decodable {
            let site: String; let type: String; let key: String } ; let results: [Vid] }
        let key = try JSONDecoder().decode(VidsResp.self, from: vidData).results
            .first { $0.site == "YouTube" && $0.type == "Trailer" }?.key
        return key.flatMap { URL(string: "https://www.youtube.com/watch?v=\($0)") }
    }
}
