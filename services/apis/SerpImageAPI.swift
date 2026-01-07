// ─────────── SerpImageAPI.swift (FULL FILE) ───────────

import Foundation
import UIKit

enum SerpImageAPIError: Error {
	case missingKey, invalidURL, parsing(Error), noResults, badImage
}

typealias SerpImageCompletion = (Result<UIImage, SerpImageAPIError>) -> Void

struct SerpImageAPI {
	// ─────────── Secrets loader
	private static let apiKey: String = {
		guard
			let path = Bundle.main.path(forResource: "Secrets", ofType: "plist"),
			let dict = NSDictionary(contentsOfFile: path),
			let key  = dict["SerpAPIKey"] as? String, !key.isEmpty
		else { fatalError("SerpAPIKey missing in Secrets.plist") }
		return key
	}()
	
	private static let endpoint = "https://serpapi.com/search.json"
	
	// ─────────── Public entry
	static func fetchTopImage(for query: String,
							  completion: @escaping SerpImageCompletion)
	{
		Task {
			do {
				if let img = try await search(query: query) {
					completion(.success(img))
				} else {
					completion(.failure(.noResults))
				}
			} catch let e as SerpImageAPIError {
				completion(.failure(e))
			} catch {
				completion(.failure(.parsing(error)))
			}
		}
	}
	
	// MARK: – Core search (single pass)
	private static func search(query: String) async throws -> UIImage? {
		var comps = URLComponents(string: endpoint)!
		var items: [URLQueryItem] = [
			.init(name: "engine",   value: "google_images"),
			.init(name: "q",        value: query),
			.init(name: "api_key",  value: apiKey),
			.init(name: "num",      value: "15"),
			.init(name: "safe",     value: "active"),
			.init(name: "tbs",      value: "isz:m"),      // medium size
			.init(name: "licenses", value: "fmc")         // widest CC-plus-commercial bucket
		]
		
		if let face = imageTypeIfNeeded(for: query) {
			items.append(.init(name: "image_type", value: face))   // face only when required
		}
		comps.queryItems = items
		guard let url = comps.url else { throw SerpImageAPIError.invalidURL }
		
		let (data, _) = try await URLSession.shared.data(from: url)
		guard
			let json    = try JSONSerialization.jsonObject(with: data) as? [String: Any],
			let results = json["images_results"] as? [[String: Any]]
		else { throw SerpImageAPIError.parsing(NSError(domain: "JSON", code: 0)) }
		
		let kw = keywords(from: query)
		
		let filtered = results.compactMap { item -> (url: URL, pixels: Int)? in
			guard
				let link  = item["original"] as? String,
				!link.lowercased().hasSuffix(".gif"),          // ditch animated junk
				let w     = item["original_width"]  as? Int?,
				let h     = item["original_height"] as? Int?,
				let url   = URL(string: link)
			else { return nil }
			
			let meta = ((item["title"] as? String) ?? "") + " " + ((item["link"] as? String) ?? "")
			let allMatch = kw.allSatisfy { meta.lowercased().contains($0) }
			return allMatch ? (url, (w ?? 0) * (h ?? 0)) : nil
		}
			.sorted(by: { $0.pixels > $1.pixels })            // biggest wins
		
		guard let best = filtered.first else { return nil }
		let (imgData, _) = try await URLSession.shared.data(from: best.url)
		guard let img = UIImage(data: imgData) else { throw SerpImageAPIError.badImage }
		return img
	}
	
	// ─────────── Helpers
	private static func imageTypeIfNeeded(for query: String) -> String? {
		let l = query.lowercased()
		let faceFlags = ["headshot", "portrait", "mugshot", "face", "official photo"]
		return faceFlags.contains(where: { l.contains($0) }) ? "face" : nil
	}
	
	private static func keywords(from query: String) -> [String] {
		query
			.lowercased()
			.split { !"abcdefghijklmnopqrstuvwxyz0123456789".contains($0) }
			.map(String.init)
			.filter { $0.count > 3 }
	}
}
