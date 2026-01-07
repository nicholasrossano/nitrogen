import Foundation

struct BookMetadata: Codable, Equatable {
	let title: String?
	let subtitle: String?
	let authors: [String]?
	let publisher: String?
	let publishedDate: String?
	let description: String?
	let categories: [String]?
	let pageCount: Int?
	let averageRating: Double?
	let ratingsCount: Int?
	let previewLink: URL?
	let industryIds: [IndustryIdentifier]?
	let cover: String?
	
	struct IndustryIdentifier: Codable, Equatable {
		let type: String?
		let identifier: String?
	}
	
	enum CodingKeys: String, CodingKey {
		case title, subtitle, authors, publisher
		case publishedDate, description, categories, pageCount
		case averageRating, ratingsCount, previewLink
		case industryIds, cover
	}
	
	init(
		title: String? = nil,
		subtitle: String? = nil,
		authors: [String]? = nil,
		publisher: String? = nil,
		publishedDate: String? = nil,
		description: String? = nil,
		categories: [String]? = nil,
		pageCount: Int? = nil,
		averageRating: Double? = nil,
		ratingsCount: Int? = nil,
		previewLink: URL? = nil,
		industryIds: [IndustryIdentifier]? = nil,
		cover: String? = nil
	) {
		self.title = title
		self.subtitle = subtitle
		self.authors = authors
		self.publisher = publisher
		self.publishedDate = publishedDate
		self.description = description
		self.categories = categories
		self.pageCount = pageCount
		self.averageRating = averageRating
		self.ratingsCount = ratingsCount
		self.previewLink = previewLink
		self.industryIds = industryIds
		self.cover = cover
	}
	
	init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		title          = try c.decodeIfPresent(String.self,    forKey: .title)
		subtitle       = try c.decodeIfPresent(String.self,    forKey: .subtitle)
		authors        = try c.decodeIfPresent([String].self,  forKey: .authors)
		publisher      = try c.decodeIfPresent(String.self,    forKey: .publisher)
		publishedDate  = try c.decodeIfPresent(String.self,    forKey: .publishedDate)
		description    = try c.decodeIfPresent(String.self,    forKey: .description)
		categories     = try c.decodeIfPresent([String].self,  forKey: .categories)
		pageCount      = try c.decodeIfPresent(Int.self,       forKey: .pageCount)
		averageRating  = try c.decodeIfPresent(Double.self,    forKey: .averageRating)
		ratingsCount   = try c.decodeIfPresent(Int.self,       forKey: .ratingsCount)
		previewLink    = try c.decodeIfPresent(URL.self,       forKey: .previewLink)
		industryIds    = try c.decodeIfPresent([IndustryIdentifier].self,
											   forKey: .industryIds)
		cover          = try c.decodeIfPresent(String.self,    forKey: .cover)
	}
	
	func encode(to encoder: Encoder) throws {
		var c = encoder.container(keyedBy: CodingKeys.self)
		try c.encodeIfPresent(title,         forKey: .title)
		try c.encodeIfPresent(subtitle,      forKey: .subtitle)
		try c.encodeIfPresent(authors,       forKey: .authors)
		try c.encodeIfPresent(publisher,     forKey: .publisher)
		try c.encodeIfPresent(publishedDate, forKey: .publishedDate)
		try c.encodeIfPresent(description,   forKey: .description)
		try c.encodeIfPresent(categories,    forKey: .categories)
		try c.encodeIfPresent(pageCount,     forKey: .pageCount)
		try c.encodeIfPresent(averageRating, forKey: .averageRating)
		try c.encodeIfPresent(ratingsCount,  forKey: .ratingsCount)
		try c.encodeIfPresent(previewLink,   forKey: .previewLink)
		try c.encodeIfPresent(industryIds,   forKey: .industryIds)
		try c.encodeIfPresent(cover,         forKey: .cover)
	}
}

extension BookMetadata {
	func highResCoverURL() -> URL? {
		coverURLCandidates().first
	}
	
	func coverURLCandidates() -> [URL] {
		var candidates: [URL] = []
		
		if let upgraded = normalizedCoverString(applyUpgrade: true),
		   !BookCoverFailureCache.shared.contains(upgraded),
		   let upgradedURL = URL(string: upgraded) {
			candidates.append(upgradedURL)
		}
		
		if let original = normalizedCoverString(applyUpgrade: false),
		   let originalURL = URL(string: original),
		   !candidates.contains(originalURL) {
			candidates.append(originalURL)
		}
		
		return candidates
	}
	
	func recordCoverFailure(_ url: URL?) {
		BookCoverFailureCache.shared.mark(url)
	}
	
	func primaryISBN13() -> String? {
		if let raw13 = industryIds?
			.first(where: { Self.norm($0.type).contains("ISBN13") })?
			.identifier,
		   let v13 = ISBNTools.cleanedISBN13IfValid(raw13) {
			return v13
		}
		if let raw10 = industryIds?
			.first(where: { Self.norm($0.type).contains("ISBN10") })?
			.identifier,
		   let v13 = ISBNTools.convertISBN10To13IfValid(raw10) {
			return v13
		}
		return nil
	}
	
	func bookshopURL(affiliateID: String? = nil) -> URL? {
		guard let isbn13 = primaryISBN13() else { return nil }
		let base = (affiliateID?.isEmpty == false)
		? "https://bookshop.org/a/\(affiliateID!)/"
		: "https://bookshop.org/book/"
		return URL(string: base + isbn13)
	}
	
	func bookshopSearchURL(affiliateID: String? = nil) -> URL? {
		let titlePart  = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		let authorPart = (authors?.first ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		let query = [titlePart, authorPart].filter { !$0.isEmpty }.joined(separator: " ")
		guard !query.isEmpty,
			  let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
		else { return nil }
		
		let base: String
		if let affiliateID, !affiliateID.isEmpty {
			base = "https://bookshop.org/a/\(affiliateID)/books?keywords="
		} else {
			base = "https://bookshop.org/books?keywords="
		}
		return URL(string: base + q)
	}
	
	func resolveBookshopURL(
		affiliateID: String? = nil,
		verifyOnline: Bool = true,
		timeout: TimeInterval = 2.5,
		fallBackToSearch: Bool = true,
		completion: @escaping (URL?) -> Void
	) {
		guard let isbn13 = primaryISBN13() else {
			completion(fallBackToSearch ? bookshopSearchURL(affiliateID: affiliateID) : nil)
			return
		}
		if let cached = BookshopResolveCache.shared.lookup(isbn13: isbn13, affiliateID: affiliateID) {
			completion(cached)
			return
		}
		guard let url = bookshopURL(affiliateID: affiliateID) else {
			completion(fallBackToSearch ? bookshopSearchURL(affiliateID: affiliateID) : nil)
			return
		}
		guard verifyOnline else {
			BookshopResolveCache.shared.store(isbn13: isbn13, affiliateID: affiliateID, url: url)
			completion(url)
			return
		}
		
		var head = URLRequest(url: url)
		head.httpMethod = "HEAD"
		head.timeoutInterval = timeout
		
		URLSession.shared.dataTask(with: head) { _, response, error in
			if let http = response as? HTTPURLResponse {
				let status = http.statusCode
				let finalURL = http.url ?? url
				
				if status == 405 || status == 403 {
					Self.pingGET(url: url, timeout: timeout) { ok, getURL, getStatus in
						let finalGetURL = getURL ?? finalURL
						if ok, Self.isLikelyBookshopProduct(finalGetURL, isbn13: isbn13) {
							BookshopResolveCache.shared.store(isbn13: isbn13, affiliateID: affiliateID, url: finalGetURL)
							completion(finalGetURL)
						} else if Self.isInvalidStatus(getStatus) || !Self.isLikelyBookshopProduct(finalGetURL, isbn13: isbn13) {
							let fb = fallBackToSearch ? self.bookshopSearchURL(affiliateID: affiliateID) : nil
							BookshopResolveCache.shared.store(isbn13: isbn13, affiliateID: affiliateID, url: fb, ttl: BookshopResolveCache.negativeTTL)
							completion(fb)
						} else if let getStatus, Self.isBlockedStatus(getStatus) {
							BookshopResolveCache.shared.store(isbn13: isbn13, affiliateID: affiliateID, url: url)
							completion(url)
						} else {
							BookshopResolveCache.shared.store(isbn13: isbn13, affiliateID: affiliateID, url: url)
							completion(url)
						}
					}
					return
				}
				
				if Self.isBlockedStatus(status) {
					BookshopResolveCache.shared.store(isbn13: isbn13, affiliateID: affiliateID, url: url)
					completion(url)
					return
				}
				
				if (200...399).contains(status), error == nil, Self.isLikelyBookshopProduct(finalURL, isbn13: isbn13) {
					BookshopResolveCache.shared.store(isbn13: isbn13, affiliateID: affiliateID, url: finalURL)
					completion(finalURL)
					return
				}
				
				if Self.isInvalidStatus(status) || !Self.isLikelyBookshopProduct(finalURL, isbn13: isbn13) {
					let fb = fallBackToSearch ? self.bookshopSearchURL(affiliateID: affiliateID) : nil
					BookshopResolveCache.shared.store(isbn13: isbn13, affiliateID: affiliateID, url: fb, ttl: BookshopResolveCache.negativeTTL)
					completion(fb)
					return
				}
			}
			
			BookshopResolveCache.shared.store(isbn13: isbn13, affiliateID: affiliateID, url: url)
			completion(url)
		}.resume()
	}
	
	private static func norm(_ s: String?) -> String {
		(s ?? "")
			.replacingOccurrences(of: "_", with: "")
			.replace("-", with: "")
			.replacingOccurrences(of: " ", with: "")
			.uppercased()
	}
	
	private static func pingGET(url: URL, timeout: TimeInterval, done: @escaping (Bool, URL?, Int?) -> Void) {
		var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
		req.httpMethod = "GET"
		req.setValue("bytes=0-0", forHTTPHeaderField: "Range")
		URLSession.shared.dataTask(with: req) { _, response, error in
			guard let http = response as? HTTPURLResponse, error == nil else {
				done(false, response?.url, (response as? HTTPURLResponse)?.statusCode)
				return
			}
			let ok = (200...399).contains(http.statusCode)
			done(ok, http.url, http.statusCode)
		}.resume()
	}
	
	private static func isLikelyBookshopProduct(_ url: URL?, isbn13: String) -> Bool {
		guard let url else { return false }
		guard url.host?.contains("bookshop.org") == true else { return false }
		let lower = url.absoluteString.lowercased()
		let isbnLower = isbn13.lowercased()
		if lower.contains(isbnLower) { return true }
		if let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) {
			if comps.queryItems?.contains(where: { $0.name.lowercased() == "ean" && ($0.value ?? "").lowercased().contains(isbnLower) }) == true {
				return true
			}
			if comps.queryItems?.contains(where: { $0.name.lowercased() == "keywords" }) == true {
				return false
			}
		}
		return false
	}
	
	private static func isInvalidStatus(_ status: Int?) -> Bool {
		guard let status else { return false }
		return status == 404 || status == 410
	}
	
	private static func isBlockedStatus(_ status: Int?) -> Bool {
		guard let status else { return false }
		return status == 403 || status == 429 || status == 503
	}
	
	private static func upgradedGoogleBooksCover(from raw: String) -> String? {
		guard var comps = URLComponents(string: raw) else { return nil }
		guard let host = comps.host?.lowercased(),
			  host.contains("books.google") else { return nil }
		
		var items = comps.queryItems ?? []
		var changed = false
		let zoomKey = "zoom"
		if let idx = items.firstIndex(where: { $0.name.lowercased() == zoomKey }) {
			let current = items[idx].value ?? ""
			if let z = Int(current), z < 3 {
				items[idx].value = "3"
				changed = true
			} else if current.isEmpty {
				items[idx].value = "3"
				changed = true
			}
		} else {
			items.append(URLQueryItem(name: zoomKey, value: "3"))
			changed = true
		}
		
		if changed {
			comps.queryItems = items
			if let url = comps.url {
				return url.absoluteString
			}
		}
		return nil
	}
	
	private func normalizedCoverString(applyUpgrade: Bool) -> String? {
		guard var s = cover?.trimmingCharacters(in: .whitespacesAndNewlines),
			  !s.isEmpty
		else { return nil }
		
		if s.hasPrefix("http://") {
			s = s.replacingOccurrences(of: "http://", with: "https://")
		}
		
		if applyUpgrade, let upgradedGoogle = Self.upgradedGoogleBooksCover(from: s) {
			s = upgradedGoogle
		}
		
		if applyUpgrade, s.contains("mzstatic.com/image/thumb/") {
			if let r = s.range(of: #"/0x\d+bb\.(png|jpg)"#, options: .regularExpression) {
				s.replaceSubrange(r, with: "/600x0w.jpg")
			} else if let r2 = s.range(of: #"/\d+x\d+bb\.(png|jpg)"#, options: .regularExpression) {
				s.replaceSubrange(r2, with: "/600x600bb.jpg")
			}
		}
		
		return s
	}
}

// ─────────── Section Header ───────────
private final class BookshopResolveCache {
	static let shared = BookshopResolveCache()
	static let negativeTTL: TimeInterval = 60 * 60 * 6
	
	private struct Entry {
		let url: URL?
		let expiresAt: Date?
	}
	
	private var cache = [String: Entry]()
	private let lock = NSLock()
	
	func key(isbn13: String, affiliateID: String?) -> String {
		"\(affiliateID ?? "none")|\(isbn13)"
	}
	
	func lookup(isbn13: String, affiliateID: String?) -> URL?? {
		let k = key(isbn13: isbn13, affiliateID: affiliateID)
		lock.lock(); defer { lock.unlock() }
		if let entry = cache[k] {
			if let expires = entry.expiresAt, expires < Date() {
				cache.removeValue(forKey: k)
				return nil
			}
			return entry.url
		}
		return nil
	}
	
	func store(isbn13: String, affiliateID: String?, url: URL?, ttl: TimeInterval? = nil) {
		let k = key(isbn13: isbn13, affiliateID: affiliateID)
		let expiry = ttl.map { Date().addingTimeInterval($0) }
		lock.lock(); cache[k] = Entry(url: url, expiresAt: expiry); lock.unlock()
	}
}

// ─────────── Section Header ───────────
private final class BookCoverFailureCache {
	static let shared = BookCoverFailureCache()
	
	private var failures = Set<String>()
	private let lock = NSLock()
	
	func contains(_ urlString: String) -> Bool {
		lock.lock(); defer { lock.unlock() }
		return failures.contains(urlString)
	}
	
	func mark(_ url: URL?) {
		guard let urlString = url?.absoluteString else { return }
		lock.lock(); failures.insert(urlString); lock.unlock()
	}
}
private enum ISBNTools {
	static func cleanedDigits(_ s: String) -> String {
		s.uppercased().filter { $0.isNumber || $0 == "X" }
	}
	
	static func cleanedISBN13IfValid(_ s: String) -> String? {
		let d = cleanedDigits(s).filter(\.isNumber)
		guard d.count == 13, isValidISBN13Digits(d) else { return nil }
		return d
	}
	
	static func convertISBN10To13IfValid(_ s: String) -> String? {
		let raw = cleanedDigits(s)
		guard raw.count == 10, isValidISBN10(raw) else { return nil }
		let core9 = raw.prefix(9)
		let twelve = "978" + core9
		let check = isbn13CheckDigit(for12: String(twelve))
		return twelve + String(check)
	}
	
	private static func isValidISBN10(_ s: String) -> Bool {
		let chars = Array(s)
		guard chars.count == 10 else { return false }
		var sum = 0
		for i in 0..<10 {
			let weight = 10 - i
			let c = chars[i]
			let val: Int
			if i == 9, c == "X" { val = 10 }
			else if let n = c.wholeNumberValue { val = n }
			else { return false }
			sum += weight * val
		}
		return sum % 11 == 0
	}
	
	private static func isValidISBN13Digits(_ digits: String) -> Bool {
		guard digits.count == 13, digits.allSatisfy(\.isNumber) else { return false }
		let nums = digits.compactMap(\.wholeNumberValue)
		let sum = nums[..<12].enumerated().reduce(0) { acc, pair in
			let (i, v) = pair
			return acc + v * (i % 2 == 0 ? 1 : 3)
		}
		let check = (10 - (sum % 10)) % 10
		return check == nums[12]
	}
	
	private static func isbn13CheckDigit(for12 s: String) -> Int {
		let nums = s.compactMap(\.wholeNumberValue)
		let sum = nums.enumerated().reduce(0) { acc, pair in
			let (i, v) = pair
			return acc + v * (i % 2 == 0 ? 1 : 3)
		}
		return (10 - (sum % 10)) % 10
	}
}

// ─────────── Section Header ───────────
private extension String {
	func replace(_ target: String, with: String) -> String {
		self.replacingOccurrences(of: target, with: with)
	}
}
