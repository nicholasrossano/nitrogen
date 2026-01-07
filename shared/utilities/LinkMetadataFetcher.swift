import Foundation
import LinkPresentation

// ─────────── LinkMetadataFetcher – tiny in-memory cache of URL → title ───────────
final class LinkMetadataFetcher {
	static let shared = LinkMetadataFetcher()
	private init() {}
	
	private let cache = NSCache<NSURL, NSString>()
	
	func title(for urlString: String, completion: @escaping (String?) -> Void) {
		guard let url = URL(string: urlString) else { completion(nil); return }
		
		// cached?
		if let cached = cache.object(forKey: url as NSURL) {
			completion(cached as String)
			return
		}
		
		// fetch
		let provider = LPMetadataProvider()
		provider.startFetchingMetadata(for: url) { [weak self] meta, _ in
			let title = meta?.title ?? url.host
			if let title = title {
				self?.cache.setObject(title as NSString, forKey: url as NSURL)
			}
			DispatchQueue.main.async { completion(title) }
		}
	}
}
