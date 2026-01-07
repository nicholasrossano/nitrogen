// OpenIn.swift
import SwiftUI
import UIKit
import FirebaseAnalytics
import Foundation

struct OpenInOption: Identifiable, Equatable {
	let id = UUID()
	let name: String
	let url: URL
}

// ─────────── Section Header ───────────

struct OpenInPill: View {
	let cardId: String?
	let options: [OpenInOption]
	
	@State private var isExpanded = false
	@State private var isPressing = false
	@Namespace private var morph
	
	@Environment(\.openURL) private var openURL
	
	var body: some View {
		if options.isEmpty {
			EmptyView()
		} else {
			content()
		}
	}
	
	// ─────────── Section Header ───────────
	private func content() -> some View {
		GeometryReader { geo in
			ZStack(alignment: .bottomTrailing) {
				
				if isExpanded && options.count > 1 {
					Color.clear
						.contentShape(Rectangle())
						.onTapGesture {
							UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.5)
							withAnimation(.interpolatingSpring(stiffness: 260, damping: 24)) {
								isExpanded = false
							}
							var params: [String: Any] = [
								"screen": "curator" as NSString,
								"option_count": NSNumber(value: options.count)
							]
							if let cardId { params["card_id"] = cardId as NSString }
							Analytics.logEvent("open_in_collapse", parameters: params)
						}
						.transition(.opacity)
						.zIndex(0)
				}
				
				let fg = Color.white
				
				if options.count == 1, let only = options.first {
					Button {
						UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.7)
						let domain = only.url.host ?? ""
						var params: [String: Any] = [
							"screen": "curator" as NSString,
							"destination_name": only.name as NSString,
							"domain": domain as NSString,
							"trigger": "open_in_single" as NSString
						]
						if let cardId { params["card_id"] = cardId as NSString }
						Analytics.logEvent("open_in_open", parameters: params)
						openURL(only.url)
					} label: {
						Text(only.name)
							.font(.caption.weight(.semibold))
							.foregroundColor(fg)
							.padding(.horizontal, 14)
							.padding(.vertical, 9)
							.scaleEffect(isPressing ? 0.96 : 1.0)
							.contentShape(Capsule())
					}
					.buttonStyle(.plain)
					.background(
						Capsule(style: .continuous)
							.fill(.ultraThinMaterial)
							.overlay(Capsule(style: .continuous).stroke(Color.white.opacity(0.6), lineWidth: 0.5))
							.shadow(color: .black.opacity(0.18), radius: 10, x: 0, y: 4)
							.matchedGeometryEffect(id: "pill_bg", in: morph)
					)
					.fixedSize(horizontal: true, vertical: true)
					.simultaneousGesture(
						DragGesture(minimumDistance: 0)
							.onChanged { _ in if !isPressing { isPressing = true } }
							.onEnded { _ in isPressing = false }
					)
					.transition(.opacity)
					.zIndex(1)
				} else {
					Group {
						if isExpanded {
							VStack(alignment: .trailing, spacing: 0) {
								ForEach(options.indices, id: \.self) { idx in
									let opt = options[idx]
									Button {
										UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.7)
										let domain = opt.url.host ?? ""
										var params: [String: Any] = [
											"screen": "curator" as NSString,
											"destination_name": opt.name as NSString,
											"domain": domain as NSString,
											"trigger": "open_in_pill" as NSString
										]
										if let cardId { params["card_id"] = cardId as NSString }
										Analytics.logEvent("open_in_open", parameters: params)
										openURL(opt.url)
										withAnimation(.interpolatingSpring(stiffness: 260, damping: 24)) {
											isExpanded = false
										}
									} label: {
										Text(opt.name)
											.font(.footnote.weight(.semibold))
											.foregroundColor(fg)
											.padding(.horizontal, 14)
											.padding(.vertical, 10)
											.contentShape(Rectangle())
									}
									.buttonStyle(.plain)
									.transition(.asymmetric(
										insertion: .move(edge: .trailing).combined(with: .opacity),
										removal: .opacity
									))
									
									if idx < options.count - 1 {
										Divider()
											.overlay(fg.opacity(0.15))
											.padding(.horizontal, 10)
									}
								}
							}
							.background(
								RoundedRectangle(cornerRadius: 18, style: .continuous)
									.fill(.ultraThinMaterial)
									.overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
										.stroke(Color.white.opacity(0.6), lineWidth: 0.5))
									.shadow(color: .black.opacity(0.18), radius: 10, x: 0, y: 4)
									.matchedGeometryEffect(id: "pill_bg", in: morph)
							)
							.fixedSize(horizontal: true, vertical: true)
							.scaleEffect(1.02, anchor: .bottomTrailing)
							.transition(.asymmetric(
								insertion: .scale(scale: 0.92, anchor: .bottomTrailing).combined(with: .opacity),
								removal: .opacity
							))
							.zIndex(1)
							
						} else {
							Button {
								UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.5)
								withAnimation(.interpolatingSpring(stiffness: 260, damping: 24)) {
									isExpanded = true
								}
								var params: [String: Any] = [
									"screen": "curator" as NSString,
									"option_count": NSNumber(value: options.count)
								]
								if let cardId { params["card_id"] = cardId as NSString }
								Analytics.logEvent("open_in_expand", parameters: params)
							} label: {
								Text("Open In...")
									.font(.caption.weight(.semibold))
									.foregroundColor(fg)
									.padding(.horizontal, 14)
									.padding(.vertical, 9)
									.scaleEffect(isPressing ? 0.96 : 1.0)
									.contentShape(Capsule())
							}
							.buttonStyle(.plain)
							.background(
								Capsule(style: .continuous)
									.fill(.ultraThinMaterial)
									.overlay(Capsule(style: .continuous).stroke(Color.white.opacity(0.6), lineWidth: 0.5))
									.shadow(color: .black.opacity(0.18), radius: 10, x: 0, y: 4)
									.matchedGeometryEffect(id: "pill_bg", in: morph)
							)
							.fixedSize(horizontal: true, vertical: true)
							.simultaneousGesture(
								DragGesture(minimumDistance: 0)
									.onChanged { _ in if !isPressing { isPressing = true } }
									.onEnded { _ in isPressing = false }
							)
							.transition(.opacity)
							.zIndex(1)
						}
					}
				}
			}
			.frame(width: geo.size.width, height: geo.size.height, alignment: .bottomTrailing)
		}
	}
}

// ─────────── Section Header ───────────

struct OpenInPillBook: View {
	let cardId: String?
	let book: BookMetadata
	
	@State private var options: [OpenInOption] = []
	
	var body: some View {
		OpenInPill(cardId: cardId, options: options)
			.onAppear {
				if options.isEmpty {
					var startParams: [String: Any] = [
						"screen": "curator" as NSString
					]
					if let cardId { startParams["card_id"] = cardId as NSString }
					Analytics.logEvent("open_in_bookshop_resolve_start", parameters: startParams)
					
					book.resolveBookshopURL(affiliateID: Affiliates.bookshop, verifyOnline: true, fallBackToSearch: false) { url in
						DispatchQueue.main.async {
							if let url {
								options = [OpenInOption(name: "Buy", url: url)]
								var okParams: [String: Any] = [
									"screen": "curator" as NSString,
									"result": "success" as NSString
								]
								if let cardId { okParams["card_id"] = cardId as NSString }
								Analytics.logEvent("open_in_bookshop_resolve_result", parameters: okParams)
							} else {
								options = []
								var noneParams: [String: Any] = [
									"screen": "curator" as NSString,
									"result": "none" as NSString
								]
								if let cardId { noneParams["card_id"] = cardId as NSString }
								Analytics.logEvent("open_in_bookshop_resolve_result", parameters: noneParams)
							}
						}
					}
				}
			}
	}
}

// ─────────── Section Header ───────────

enum OpenLibraryAmazonResolver {
	private static let session: URLSession = {
		let config = URLSessionConfiguration.default
		config.timeoutIntervalForRequest = 6
		config.timeoutIntervalForResource = 6
		return URLSession(configuration: config)
	}()
	
	static func resolve(book: BookMetadata, completion: @escaping (URL?) -> Void) {
		let baseKey = cacheKey(for: book)
		if let cached = Cache.shared[baseKey] {
			completion(cached); return
		}
		
		let isbns = extractISBNs(from: book)
		booksAPIByISBNs(isbns) { asin in
			if let asin, let url = URL(string: "https://www.amazon.com/dp/\(asin)") {
				Cache.shared[baseKey] = url; completion(url); return
			}
			editionsChainFromISBNs(isbns) { asin2 in
				if let asin2, let url = URL(string: "https://www.amazon.com/dp/\(asin2)") {
					Cache.shared[baseKey] = url; completion(url); return
				}
				searchAndCheck(title: book.title, author: (book.authors ?? []).first) { asin3 in
					if let asin3, let url = URL(string: "https://www.amazon.com/dp/\(asin3)") {
						Cache.shared[baseKey] = url; completion(url); return
					}
					completion(nil)
				}
			}
		}
	}
	
	// ─────────── Section Header ───────────
	private static func cacheKey(for book: BookMetadata) -> String {
		let t = (book.title ?? "").lowercased()
		let a = (book.authors ?? []).first?.lowercased() ?? ""
		let i10 = isbn10(from: book) ?? ""
		let i13 = isbn13(from: book) ?? ""
		return "\(t)|\(a)|\(i10)|\(i13)"
	}
	
	private static func extractISBNs(from book: BookMetadata) -> [String] {
		var set = Set<String>()
		if let i13 = isbn13(from: book) { set.insert(i13) }
		if let i10 = isbn10(from: book) { set.insert(i10) }
		if let i13 = isbn13(from: book), i13.hasPrefix("978"),
		   let conv = convertISBN13to10(i13) { set.insert(conv) }
		return Array(set)
	}
	
	private static func isbn13(from book: BookMetadata) -> String? {
		book.industryIds?
			.first(where: { ($0.type ?? "").replacingOccurrences(of: "_", with: "").uppercased().contains("ISBN13") })?
			.identifier?
			.filter { "0123456789".contains($0) }
			.nonEmpty
	}
	
	private static func isbn10(from book: BookMetadata) -> String? {
		book.industryIds?
			.first(where: { ($0.type ?? "").replacingOccurrences(of: "_", with: "").uppercased().contains("ISBN10") })?
			.identifier?
			.uppercased()
			.filter { "0123456789X".contains($0) }
			.nonEmpty
	}
	
	private static func convertISBN13to10(_ isbn13: String) -> String? {
		let digits = isbn13.filter { "0123456789".contains($0) }
		guard digits.count == 13, digits.hasPrefix("978") else { return nil }
		let body9 = digits.dropFirst(3).prefix(9)
		var sum = 0
		for (i, ch) in body9.enumerated() {
			guard let d = ch.wholeNumberValue else { return nil }
			sum += d * (10 - i)
		}
		let remainder = 11 - (sum % 11)
		let check: String
		switch remainder {
		case 10: check = "X"
		case 11: check = "0"
		default: check = String(remainder)
		}
		return String(body9) + check
	}
	
	// ─────────── Section Header ───────────
	private static func booksAPIByISBNs(_ isbns: [String], completion: @escaping (String?) -> Void) {
		guard !isbns.isEmpty else { completion(nil); return }
		let bibkeys = isbns.map { "ISBN:\($0)" }.joined(separator: ",")
		guard let url = URL(string: "https://openlibrary.org/api/books?bibkeys=\(bibkeys)&format=json&jscmd=data") else {
			completion(nil); return
		}
		session.dataTask(with: url) { data, _, _ in
			guard let data,
				  let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
				completion(nil); return
			}
			for key in isbns {
				if let node = root["ISBN:\(key)"] as? [String: Any],
				   let ids = node["identifiers"] as? [String: Any],
				   let amazon = ids["amazon"] as? [Any],
				   let first = amazon.first as? String,
				   !first.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
					completion(first.trimmingCharacters(in: .whitespacesAndNewlines)); return
				}
			}
			completion(nil)
		}.resume()
	}
	
	private static func editionsChainFromISBNs(_ isbns: [String], completion: @escaping (String?) -> Void) {
		guard !isbns.isEmpty else { completion(nil); return }
		tryNext(isbns, idx: 0, completion: completion)
		
		func tryNext(_ list: [String], idx: Int, completion: @escaping (String?) -> Void) {
			guard idx < list.count else { completion(nil); return }
			let isbn = list[idx]
			isbnToWork(isbn: isbn) { workKey in
				guard let workKey else { tryNext(list, idx: idx + 1, completion: completion); return }
				workToEditions(workKey: workKey, limit: 25) { asin in
					if let asin { completion(asin) }
					else { tryNext(list, idx: idx + 1, completion: completion) }
				}
			}
		}
	}
	
	private static func isbnToWork(isbn: String, completion: @escaping (String?) -> Void) {
		guard let url = URL(string: "https://openlibrary.org/isbn/\(isbn).json") else {
			completion(nil); return
		}
		session.dataTask(with: url) { data, _, _ in
			guard let data,
				  let node = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
				completion(nil); return
			}
			if let works = node["works"] as? [[String: Any]],
			   let key = works.first?["key"] as? String,
			   key.hasPrefix("/works/") {
				completion(key)
			} else {
				completion(nil)
			}
		}.resume()
	}
	
	private static func workToEditions(workKey: String, limit: Int, completion: @escaping (String?) -> Void) {
		let trimmed = workKey.hasPrefix("/works/") ? String(workKey.dropFirst(1)) : workKey
		guard let url = URL(string: "https://openlibrary.org/\(trimmed)/editions.json?limit=\(limit)") else {
			completion(nil); return
		}
		session.dataTask(with: url) { data, _, _ in
			guard let data,
				  let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
				  let entries = root["entries"] as? [[String: Any]] else {
				completion(nil); return
			}
			for ed in entries {
				if let ids = ed["identifiers"] as? [String: Any],
				   let amazon = ids["amazon"] as? [Any],
				   let first = amazon.first as? String,
				   !first.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
					completion(first.trimmingCharacters(in: .whitespacesAndNewlines)); return
				}
			}
			completion(nil)
		}.resume()
	}
	
	private static func searchAndCheck(title: String?, author: String?, completion: @escaping (String?) -> Void) {
		let t = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		guard !t.isEmpty else { completion(nil); return }
		var comps = URLComponents(string: "https://openlibrary.org/search.json")!
		var q = t
		if let a = author?.trimmingCharacters(in: .whitespacesAndNewlines), !a.isEmpty {
			q += " \(a)"
		}
		comps.queryItems = [URLQueryItem(name: "q", value: q), URLQueryItem(name: "limit", value: "3")]
		guard let url = comps.url else { completion(nil); return }
		session.dataTask(with: url) { data, _, _ in
			guard let data,
				  let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
				  let docs = root["docs"] as? [[String: Any]] else {
				completion(nil); return
			}
			var isbnCandidates: [String] = []
			for d in docs {
				if let arr = d["isbn"] as? [Any] {
					for any in arr {
						if let s = any as? String {
							let cleaned = s.uppercased().filter { "0123456789X".contains($0) }
							if cleaned.count == 10 || cleaned.count == 13 { isbnCandidates.append(cleaned) }
						}
					}
				}
			}
			booksAPIByISBNs(isbnCandidates) { asin in
				if let asin { completion(asin); return }
				for d in docs {
					if let key = d["key"] as? String, key.hasPrefix("/works/") {
						workToEditions(workKey: key, limit: 25) { asin2 in
							if let asin2 { completion(asin2) } else { /* next */ }
						}
						return
					}
				}
				completion(nil)
			}
		}.resume()
	}
	
	// ─────────── Section Header ───────────
	private final class Cache {
		static let shared = Cache()
		private var store: [String: URL] = [:]
		private let lock = NSLock()
		subscript(key: String) -> URL? {
			get { lock.lock(); defer { lock.unlock() }; return store[key] }
			set { lock.lock(); store[key] = newValue; lock.unlock() }
		}
	}
}

// ─────────── Section Header ───────────

extension MusicMetadata {
	func openInOptions() -> [OpenInOption] {
		var opts: [OpenInOption] = []
		if let spotify = spotifyURL { opts.append(OpenInOption(name: "Spotify", url: spotify)) }
		if let apple = appleMusicURL { opts.append(OpenInOption(name: "Apple Music", url: apple)) }
		return opts
	}
}

extension BookMetadata {
	func openInOptions() -> [OpenInOption] {
		var items: [OpenInOption] = []
		if let goodreads = goodreadsURL() {
			items.append(OpenInOption(name: "Goodreads", url: goodreads))
		}
		// Amazon intentionally removed from BookWidget "Open In" options.
		return items
	}
	
	private func goodreadsURL() -> URL? {
		guard let id = industryIds?.first(where: { ($0.type ?? "").uppercased().contains("ISBN") })?.identifier else { return nil }
		return URL(string: "https://www.goodreads.com/book/isbn/\(id)")
	}
}

extension FilmTvMetadata {
	func openInOptions() -> [OpenInOption] {
		if let u = imdbURL {
			return [OpenInOption(name: "IMDb", url: u)]
		}
		if let id = imdbID, let u = URL(string: "https://www.imdb.com/title/\(id)/") {
			return [OpenInOption(name: "IMDb", url: u)]
		}
		return []
	}
}

// ─────────── Section Header ───────────

private extension String {
	var nonEmpty: String? { isEmpty ? nil : self }
}
