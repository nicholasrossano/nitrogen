import SwiftUI
import SDWebImageSwiftUI
import SafariServices
import FirebaseAnalytics
import FirebaseAuth
import FirebaseFirestore

struct SourceListView: View {
	let sources: [Source]
	let cardId: String
	let topicId: String?
	
	@EnvironmentObject private var servicesLocator: AppServicesLocator
	
	@State private var displayedSources: [Source] = []
	@State private var isAdmin: Bool = false
	
	@State private var showDeleteError: Bool = false
	@State private var deleteErrorMessage: String = ""
	
	private let firestore = Firestore.firestore()
	
	init(sources: [Source], cardId: String, topicId: String? = nil) {
		self.sources = sources
		self.cardId = cardId
		self.topicId = topicId
	}
	
	var body: some View {
		VStack(spacing: 0) {
			Text("Sources")
				.font(.headline)
				.frame(maxWidth: .infinity, alignment: .center)
				.padding(.top, 24)
				.padding(.bottom, 8)
			
			List {
				ForEach(Array(displayedSources.enumerated()), id: \.offset) { idx, src in
					Group {
						if isAdmin {
							SourceRow(source: src, cardId: cardId, index: idx)
								.swipeActions(edge: .trailing, allowsFullSwipe: true) {
									Button(role: .destructive) {
										deleteSource(at: idx)
									} label: {
										Label("", systemImage: "trash")
									}
								}
						} else {
							SourceRow(source: src, cardId: cardId, index: idx)
						}
					}
					.listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
					.listRowSeparator(.hidden)
					.listRowBackground(Color.clear)
				}
			}
			.listStyle(.plain)
			.scrollContentBackground(.hidden)
			.scrollIndicators(.hidden)
			.background(.clear)
			.safeAreaInset(edge: .bottom) {
				Color.clear.frame(height: 100)
			}
		}
		.onAppear {
			displayedSources = sources
			isAdmin = (FeatureFlagsManager.shared.currentUserRole == "admin")
		}
		.alert("Couldn’t remove source", isPresented: $showDeleteError) {
			Button("OK", role: .cancel) { }
		} message: {
			Text(deleteErrorMessage)
		}
		.ignoresSafeArea(.container, edges: .bottom)
		.asNativeSheet()
	}
	
	// ─────────── Admin delete ───────────
	
	private func deleteSource(at index: Int) {
		guard isAdmin else { return }
		guard index >= 0, index < displayedSources.count else { return }
		
		let src = displayedSources[index]
		let domain = normalizedDomain(from: src.url) ?? ""
		let name = (src.name ?? src.headline ?? domain)
		let topic = (topicId ?? "")
		
		Analytics.logEvent("source_delete_swipe", parameters: [
			"card_id": cardId as NSString,
			"topic_id": topic as NSString,
			"screen": "SourceListView" as NSString,
			"trigger": "swipe_delete" as NSString,
			"position": NSNumber(value: index),
			"domain": domain as NSString,
			"source_name": name as NSString
		])
		
		displayedSources.remove(at: index)
		
		verifyAdminAndRemoveFromCard(cardId: cardId, source: src) { result in
			DispatchQueue.main.async {
				switch result {
				case .success:
					Analytics.logEvent("source_delete_success", parameters: [
						"card_id": self.cardId as NSString,
						"topic_id": topic as NSString,
						"screen": "SourceListView" as NSString,
						"trigger": "swipe_delete" as NSString,
						"position": NSNumber(value: index),
						"domain": domain as NSString,
						"source_name": name as NSString
					])
				case .failure(let error):
					let insertIndex = min(index, self.displayedSources.count)
					self.displayedSources.insert(src, at: insertIndex)
					
					self.deleteErrorMessage = error.localizedDescription
					self.showDeleteError = true
					
					Analytics.logEvent("source_delete_error", parameters: [
						"card_id": self.cardId as NSString,
						"topic_id": topic as NSString,
						"screen": "SourceListView" as NSString,
						"trigger": "swipe_delete" as NSString,
						"position": NSNumber(value: index),
						"domain": domain as NSString,
						"source_name": name as NSString,
						"error": error.localizedDescription as NSString
					])
				}
			}
		}
	}
	
	private func verifyAdminAndRemoveFromCard(
		cardId: String,
		source: Source,
		completion: @escaping (Result<Void, Error>) -> Void
	) {
		guard let uid = Auth.auth().currentUser?.uid else {
			completion(.failure(NSError(
				domain: "SourceListView",
				code: 0,
				userInfo: [NSLocalizedDescriptionKey: "No user logged in"]
			)))
			return
		}
		
		firestore.collection("users").document(uid).getDocument { doc, err in
			if let err = err {
				completion(.failure(err))
				return
			}
			
			let role = doc?.data()?["role"] as? String ?? "user"
			guard role == "admin" else {
				completion(.failure(NSError(
					domain: "SourceListView",
					code: 403,
					userInfo: [NSLocalizedDescriptionKey: "Admin access required"]
				)))
				return
			}
			
			self.removeSourceFromCardDocument(cardId: cardId, source: source, completion: completion)
		}
	}
	
	private func removeSourceFromCardDocument(
		cardId: String,
		source: Source,
		completion: @escaping (Result<Void, Error>) -> Void
	) {
		let cardRef = firestore.collection("cards").document(cardId)
		
		firestore.runTransaction({ transaction, errorPointer -> Any? in
			do {
				let snap = try transaction.getDocument(cardRef)
				let data = snap.data() ?? [:]
				let currentSources = data["sources"] as? [[String: Any]] ?? []
				
				let filtered = currentSources.filter { dict in
					!self.matchesSource(dict: dict, source: source)
				}
				
				if filtered.count == currentSources.count {
					errorPointer?.pointee = NSError(
						domain: "SourceListView",
						code: 404,
						userInfo: [NSLocalizedDescriptionKey: "That source wasn’t found on the card in Firebase."]
					)
					return nil
				}
				
				transaction.updateData([
					"sources": filtered
				], forDocument: cardRef)
				
				return nil
			} catch let error as NSError {
				errorPointer?.pointee = error
				return nil
			}
		}) { _, err in
			if let err = err {
				completion(.failure(err))
			} else {
				completion(.success(()))
			}
		}
	}
	
	private func matchesSource(dict: [String: Any], source: Source) -> Bool {
		if let a = normalizedURLKey(source.url),
		   let b = normalizedURLKey(dict["url"] as? String),
		   a == b {
			return true
		}
		
		if let a = normalizedText(source.headline),
		   let b = normalizedText(dict["headline"] as? String),
		   a == b {
			return true
		}
		
		if let a = normalizedText(source.name),
		   let b = normalizedText(dict["name"] as? String),
		   a == b {
			return true
		}
		
		if let a = normalizedURLKey(source.iconUrl),
		   let b = normalizedURLKey(dict["iconUrl"] as? String),
		   a == b {
			return true
		}
		
		return false
	}
	
	private func normalizedText(_ raw: String?) -> String? {
		let s = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		return s.isEmpty ? nil : s
	}
	
	private func normalizedURLKey(_ raw: String?) -> String? {
		let s0 = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		guard !s0.isEmpty else { return nil }
		
		let secure = s0.hasPrefix("http://")
		? s0.replacingOccurrences(of: "http://", with: "https://")
		: s0
		
		guard let url = URL(string: secure) else { return secure.lowercased() }
		
		var host = (url.host ?? "").lowercased()
		if host.hasPrefix("www.") { host.removeFirst(4) }
		
		var path = url.path.lowercased()
		while path.hasSuffix("/") { path.removeLast() }
		
		return host + path
	}
	
	private func normalizedDomain(from urlString: String?) -> String? {
		guard let str = urlString, let url = URL(string: str) else { return nil }
		var host = (url.host ?? "").lowercased()
		if host.hasPrefix("www.") { host.removeFirst(4) }
		return host.isEmpty ? nil : host
	}
}

private struct SourceRow: View {
	let source: Source
	let cardId: String
	let index : Int
	
	@EnvironmentObject private var servicesLocator: AppServicesLocator
	@State private var showSafari = false
	@State private var resolvedHeadline: String?
	
	var body: some View {
		Button {
			showSafari = true
		} label: {
			HStack(spacing: 12) {
				if let iconStr = source.iconUrl,
				   let iconURL = URL(string: iconStr) {
					WebImage(url: iconURL)
						.resizable()
						.aspectRatio(contentMode: .fill)
						.frame(width: 38, height: 38)
						.clipShape(RoundedRectangle(cornerRadius: 6))
				} else {
					RoundedRectangle(cornerRadius: 6)
						.fill(Color.gray.opacity(0.3))
						.frame(width: 38, height: 38)
				}
				
				Text(primaryText)
					.font(.custom("Avenir", size: 15))
					.foregroundColor(.primary)
					.multilineTextAlignment(.leading)
				
				Spacer(minLength: 0)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.sheet(isPresented: $showSafari) {
			if let link = source.url,
			   let url = URL(string: link) {
				SafariView(url: url)
					.onAppear { logSourceTap(url: url) }
			}
		}
		.task { fetchHeadlineIfNeeded() }
	}
	
	private var primaryText: String {
		source.headline
		?? resolvedHeadline
		?? source.name
		?? domain(from: source.url)
		?? "Untitled"
	}
	
	private func fetchHeadlineIfNeeded() {
		guard resolvedHeadline == nil,
			  source.headline == nil,
			  let link = source.url
		else { return }
		
		LinkMetadataFetcher.shared.title(for: link) { title in
			resolvedHeadline = title
		}
	}
	
	private func domain(from urlString: String?) -> String? {
		guard let str = urlString, let url = URL(string: str) else { return nil }
		return url.host
	}
	
	private func normalizedDomain(from url: URL) -> String {
		var host = (url.host ?? "").lowercased()
		if host.hasPrefix("www.") { host.removeFirst(4) }
		return host
	}
	
	private func logSourceTap(url: URL) {
		let domain = normalizedDomain(from: url)
		let name   = (source.name ?? domain)
		Analytics.logEvent("source_open", parameters: [
			"card_id": cardId as NSString,
			"source_name": name as NSString,
			"domain": domain as NSString,
			"position": NSNumber(value: index),
			"screen": "SourceListView" as NSString
		])
	}
}
