import FirebaseFirestore
import FirebaseAuth
import Combine

class CardService {
	// ─────────── Internals ───────────
	private let firestore = Firestore.firestore()
	private var currentUserId: String? { Auth.auth().currentUser?.uid }
	
	// MARK: – Public API
	
	// Topic-based fetch (legacy; still used where needed, but domains are primary going forward)
	func fetchCardsByTopic(_ topic: String,
						   limit: Int? = nil,
						   lastDocument: DocumentSnapshot? = nil
	) -> AnyPublisher<([Card], DocumentSnapshot?), Error> {
		
		return Future { [weak self] promise in
			guard let self = self else { return }
			self.fetchCardsInternal(
				topicsFilter: [.single(topic)],
				limit: limit,
				lastDocument: lastDocument,
				promise: promise
			)
		}
		.eraseToAnyPublisher()
	}
	
	func fetchCardsForTopics(_ topics: [String],
							 limit: Int? = nil,
							 lastDocument: DocumentSnapshot? = nil
	) -> AnyPublisher<([Card], DocumentSnapshot?), Error> {
		
		return Future { [weak self] promise in
			guard let self = self else { return }
			
			guard !topics.isEmpty else {
				self.fetchCardsInternal(
					topicsFilter: [],
					limit: limit,
					lastDocument: lastDocument,
					promise: promise
				)
				return
			}
			
			let chunks: [[String]] = stride(from: 0, to: topics.count, by: 10).map {
				Array(topics[$0..<min($0+10, topics.count)])
			}
			
			var all: [Card] = []
			let group = DispatchGroup()
			var firstError: Error?
			
			for chunk in chunks {
				group.enter()
				self.fetchCardsInternal(
					topicsFilter: [.multiple(chunk)],
					limit: limit,
					lastDocument: nil
				) { result in
					switch result {
					case .success(let (cards, _)):
						all.append(contentsOf: cards)
					case .failure(let err):
						if firstError == nil { firstError = err }
					}
					group.leave()
				}
			}
			
			group.notify(queue: .main) {
				if let err = firstError {
					promise(.failure(err))
					return
				}
				var seen = Set<String>()
				var merged: [Card] = []
				for c in all {
					if !seen.contains(c.id) {
						seen.insert(c.id)
						merged.append(c)
					}
				}
				let cal = Calendar.current
				merged.sort { a, b in
					let t1 = a.timestamp ?? .distantPast
					let t2 = b.timestamp ?? .distantPast
					let d1 = cal.startOfDay(for: t1)
					let d2 = cal.startOfDay(for: t2)
					if d1 != d2 { return t1 > t2 }
					let r1 = a.rankingScore ?? 0
					let r2 = b.rankingScore ?? 0
					if r1 != r2 { return r1 > r2 }
					return t1 > t2
				}
				if let lim = limit, merged.count > lim { merged = Array(merged.prefix(lim)) }
				promise(.success((merged, nil)))
			}
		}
		.eraseToAnyPublisher()
	}
	
	// Domain-agnostic recent feed (used when no domain preferences exist)
	func fetchCardsForHomeFeed(limit: Int? = nil,
							   lastDocument: DocumentSnapshot? = nil
	) -> AnyPublisher<([Card], DocumentSnapshot?), Error> {
		
		return Future { [weak self] promise in
			guard let self = self else { return }
			self.fetchCardsInternal(
				topicsFilter: [],
				limit: limit,
				lastDocument: lastDocument,
				promise: promise
			)
		}
		.eraseToAnyPublisher()
	}
	
	// Domain-based union fetch for For You (selected domains only)
	func fetchCardsForDomains(_ domainIds: [String],
							  limit: Int? = nil,
							  lastDocument: DocumentSnapshot? = nil
	) -> AnyPublisher<([Card], DocumentSnapshot?), Error> {
		
		return Future { [weak self] promise in
			guard let self = self else { return }
			guard !domainIds.isEmpty else {
				promise(.success(([], nil)))
				return
			}
			
			guard let userId = self.currentUserId else {
				promise(.failure(NSError(domain: "CardService", code: 0,
										 userInfo: [NSLocalizedDescriptionKey: "No user logged in"])))
				return
			}
			
			let cutoff = Calendar.current.date(byAdding: .day, value: -28, to: Date()) ?? Date()
			
			self.firestore.collection("users")
				.document(userId)
				.collection("cardReads")
				.whereField("readAt", isGreaterThanOrEqualTo: Timestamp(date: cutoff))
				.getDocuments { [weak self] readSnap, readErr in
					guard let self = self else { return }
					
					if let readErr = readErr {
#if DEBUG
						print("[CardService] cardReads fetch failed (domains union); continuing without read filter:", readErr.localizedDescription)
#endif
					}
					
					let readIds = Set(readSnap?.documents.map { $0.documentID } ?? [])
					
					let chunks: [[String]] = stride(from: 0, to: domainIds.count, by: 10).map {
						Array(domainIds[$0..<min($0+10, domainIds.count)])
					}
					
					var all: [Card] = []
					let group = DispatchGroup()
					var firstError: Error?
					
					for chunk in chunks {
						group.enter()
						
						var q: Query = self.firestore.collection("cards")
						q = q.whereField("status", isEqualTo: "approved")
							.whereField("timestamp", isGreaterThanOrEqualTo: Timestamp(date: cutoff))
							.whereField("enrichedMetadata.domain.id", in: chunk)
							.order(by: "timestamp", descending: true)
						
						if let lim = limit {
							let overshoot = max(readIds.count, 50)
							q = q.limit(to: lim + overshoot)
						}
						
						q.getDocuments { snap, err in
							defer { group.leave() }
							if let err = err {
								if firstError == nil { firstError = err }
								return
							}
							guard let snap = snap else { return }
							for doc in snap.documents {
								if readIds.contains(doc.documentID) { continue }
								if let card = Self.parseDoc(doc) {
									all.append(card)
								}
							}
						}
					}
					
					group.notify(queue: .main) {
						if let err = firstError {
							promise(.failure(err))
							return
						}
						
						guard !all.isEmpty else {
							promise(.success(([], nil)))
							return
						}
						
						var seen = Set<String>()
						var merged: [Card] = []
						for c in all {
							if !seen.contains(c.id) {
								seen.insert(c.id)
								merged.append(c)
							}
						}
						
						let cal = Calendar.current
						merged.sort { a, b in
							guard let t1 = a.timestamp, let t2 = b.timestamp else { return false }
							let d1 = cal.startOfDay(for: t1)
							let d2 = cal.startOfDay(for: t2)
							if d1 != d2 { return t1 > t2 }
							let r1 = a.rankingScore ?? 0
							let r2 = b.rankingScore ?? 0
							if r1 != r2 { return r1 > r2 }
							return t1 > t2
						}
						
						if let lim = limit, merged.count > lim {
							merged = Array(merged.prefix(lim))
						}
						
						promise(.success((merged, nil)))
					}
				}
		}
		.eraseToAnyPublisher()
	}
	
	// ─────────── Domain-based fetch (single domain, used for domain pages) ───────────
	
	func fetchCardsByDomain(_ domainId: String,
							limit: Int? = nil,
							lastDocument: DocumentSnapshot? = nil
	) -> AnyPublisher<([Card], DocumentSnapshot?), Error> {
		
		return Future { [weak self] promise in
			guard let self = self else { return }
			self.fetchCardsByDomainInternal(
				domainId: domainId,
				limit: limit,
				lastDocument: lastDocument,
				promise: promise
			)
		}
		.eraseToAnyPublisher()
	}
	
	// MARK: – Internal implementation
	
	private enum TopicFilter { case single(String); case multiple([String]) }
	
	private func fetchCardsInternal(
		topicsFilter: [TopicFilter],
		limit: Int?,
		lastDocument: DocumentSnapshot?,
		promise: @escaping (Result<([Card], DocumentSnapshot?), Error>) -> Void
	) {
		guard let userId = currentUserId else {
			promise(.failure(NSError(domain: "CardService", code: 0,
									 userInfo: [NSLocalizedDescriptionKey: "No user logged in"]))); return
		}
		
		let cutoff = Calendar.current.date(byAdding: .day, value: -28, to: Date()) ?? Date()
		
		firestore.collection("users")
			.document(userId)
			.collection("cardReads")
			.whereField("readAt", isGreaterThanOrEqualTo: Timestamp(date: cutoff))
			.getDocuments { [weak self] readSnap, readErr in
				guard let self = self else { return }
				
				if let readErr = readErr {
#if DEBUG
					print("[CardService] cardReads fetch failed; continuing without read filter:", readErr.localizedDescription)
#endif
				}
				let readIds = Set(readSnap?.documents.map { $0.documentID } ?? [])
				
				var q: Query = self.firestore.collection("cards")
				q = q.whereField("status", isEqualTo: "approved")
					.whereField("timestamp", isGreaterThanOrEqualTo: Timestamp(date: cutoff))
					.order(by: "timestamp", descending: true)
				
				for filter in topicsFilter {
					switch filter {
					case .single(let t):
						q = q.whereField("topic", isEqualTo: t)
					case .multiple(let ts):
						if !ts.isEmpty { q = q.whereField("topic", in: ts) }
					}
				}
				
				if let lim = limit {
					let overshoot = max(readIds.count, 50)
					q = q.limit(to: lim + overshoot)
				}
				if let last = lastDocument { q = q.start(afterDocument: last) }
				
				q.getDocuments { snap, err in
					if let err = err { promise(.failure(err)); return }
					guard let snap else { promise(.success(([], nil))); return }
					
					var cards = snap.documents.compactMap { doc -> Card? in
						readIds.contains(doc.documentID) ? nil : Self.parseDoc(doc)
					}
					
					let cal = Calendar.current
					cards.sort { a, b in
						guard let t1 = a.timestamp, let t2 = b.timestamp else { return false }
						let d1 = cal.startOfDay(for: t1)
						let d2 = cal.startOfDay(for: t2)
						if d1 != d2 { return t1 > t2 }
						let r1 = a.rankingScore ?? 0
						let r2 = b.rankingScore ?? 0
						if r1 != r2 { return r1 > r2 }
						return t1 > t2
					}
					
					if let lim = limit, cards.count > lim {
						cards = Array(cards.prefix(lim))
					}
					
					let includedIDs = Set(cards.map { $0.id })
					let lastDisplayed = snap.documents.reversed().first { includedIDs.contains($0.documentID) }
					let cursor = lastDisplayed ?? snap.documents.last
					
					promise(.success((cards, cursor)))
				}
			}
	}
	
	private func fetchCardsByDomainInternal(
		domainId: String,
		limit: Int?,
		lastDocument: DocumentSnapshot?,
		promise: @escaping (Result<([Card], DocumentSnapshot?), Error>) -> Void
	) {
		guard let userId = currentUserId else {
			promise(.failure(NSError(domain: "CardService", code: 0,
									 userInfo: [NSLocalizedDescriptionKey: "No user logged in"]))); return
		}
		
		let cutoff = Calendar.current.date(byAdding: .day, value: -28, to: Date()) ?? Date()
		
		firestore.collection("users")
			.document(userId)
			.collection("cardReads")
			.whereField("readAt", isGreaterThanOrEqualTo: Timestamp(date: cutoff))
			.getDocuments { [weak self] readSnap, readErr in
				guard let self = self else { return }
				
				if let readErr = readErr {
#if DEBUG
					print("[CardService] cardReads fetch failed (single domain); continuing without read filter:", readErr.localizedDescription)
#endif
				}
				let readIds = Set(readSnap?.documents.map { $0.documentID } ?? [])
				
				var q: Query = self.firestore.collection("cards")
				q = q.whereField("status", isEqualTo: "approved")
					.whereField("timestamp", isGreaterThanOrEqualTo: Timestamp(date: cutoff))
					.whereField("enrichedMetadata.domain.id", isEqualTo: domainId)
					.order(by: "timestamp", descending: true)
				
				if let lim = limit {
					let overshoot = max(readIds.count, 50)
					q = q.limit(to: lim + overshoot)
				}
				if let last = lastDocument { q = q.start(afterDocument: last) }
				
				q.getDocuments { snap, err in
					if let err = err { promise(.failure(err)); return }
					guard let snap else { promise(.success(([], nil))); return }
					
					var cards = snap.documents.compactMap { doc -> Card? in
						readIds.contains(doc.documentID) ? nil : Self.parseDoc(doc)
					}
					
					let cal = Calendar.current
					cards.sort { a, b in
						guard let t1 = a.timestamp, let t2 = b.timestamp else { return false }
						let d1 = cal.startOfDay(for: t1)
						let d2 = cal.startOfDay(for: t2)
						if d1 != d2 { return t1 > t2 }
						let r1 = a.rankingScore ?? 0
						let r2 = b.rankingScore ?? 0
						if r1 != r2 { return r1 > r2 }
						return t1 > t2
					}
					
					if let lim = limit, cards.count > lim {
						cards = Array(cards.prefix(lim))
					}
					
					let includedIDs = Set(cards.map { $0.id })
					let lastDisplayed = snap.documents.reversed().first { includedIDs.contains($0.documentID) }
					let cursor = lastDisplayed ?? snap.documents.last
					
					promise(.success((cards, cursor)))
				}
			}
	}
	
	// MARK: – Parser
	
	private static func parseDoc(_ doc: QueryDocumentSnapshot) -> Card? {
		let d = doc.data()
		let sources = (d["sources"] as? [[String: Any]])?.compactMap {
			Source(fromJson: $0)
		} ?? []
		let enriched = (d["enrichedMetadata"] as? [String: Any])
			.flatMap { EnrichedMetadata(fromJson: $0) }
		
		return Card(
			id: doc.documentID,
			body: d["body"] as? String,
			headline: d["headline"] as? String,
			timestamp: (d["timestamp"] as? Timestamp)?.dateValue(),
			topic: d["topic"] as? String,
			sources: sources,
			directPlagiarismScore: d["directPlagiarismScore"] as? Double,
			rankingScore: d["rankingScore"] as? Double,
			status: d["status"] as? String,
			reasonCode: d["reasonCode"] as? String,
			spoiler: d["spoiler"] as? Bool,
			enrichedMetadata: enriched,
			isWidgetDisabled: d["isWidgetDisabled"] as? Bool ?? false
		)
	}
	
	// MARK: – Misc
	
	func fetchCardById(_ cardId: String) -> AnyPublisher<Card?, Error> {
		return Future { [weak self] promise in
			guard let self = self else { return }
			let ref = self.firestore.collection("cards").document(cardId)
			ref.getDocument { doc, err in
				if let err = err { promise(.failure(err)); return }
				guard let doc = doc, doc.exists else { promise(.success(nil)); return }
				let d = doc.data() ?? [:]
				let sources = (d["sources"] as? [[String: Any]])?.compactMap {
					Source(fromJson: $0)
				} ?? []
				let enriched = (d["enrichedMetadata"] as? [String: Any])
					.flatMap { EnrichedMetadata(fromJson: $0) }
				
				let card = Card(
					id: doc.documentID,
					body: d["body"] as? String,
					headline: d["headline"] as? String,
					timestamp: (d["timestamp"] as? Timestamp)?.dateValue(),
					topic: d["topic"] as? String,
					sources: sources,
					directPlagiarismScore: d["directPlagiarismScore"] as? Double,
					rankingScore: d["rankingScore"] as? Double,
					status: d["status"] as? String,
					reasonCode: d["reasonCode"] as? String,
					spoiler: d["spoiler"] as? Bool,
					enrichedMetadata: enriched,
					isWidgetDisabled: d["isWidgetDisabled"] as? Bool ?? false
				)
				promise(.success(card))
			}
		}
		.eraseToAnyPublisher()
	}
	
	func logSwipe(cardId: String, direction: String, state: Bool) -> AnyPublisher<Void, Error> {
		return Future { [weak self] promise in
			guard let self = self else { return }
			guard let userId = self.currentUserId else {
				promise(.failure(NSError(domain: "CardService", code: 0,
										 userInfo: [NSLocalizedDescriptionKey: "No user logged in"])))
				return
			}
			
			let stateStr = state ? "expanded" : "collapsed"
			let ref = self.firestore.collection("userActions")
			
			if direction == "left" {
				let data: [String: Any] = [
					"userID": userId,
					"cardID": cardId,
					"actionType": "swiped_left",
					"cardState": stateStr,
					"timestamp": Timestamp(date: Date())
				]
				ref.document().setData(data) { err in
					err == nil ? promise(.success(())) : promise(.failure(err!))
				}
			} else {
				ref.whereField("userID", isEqualTo: userId)
					.whereField("cardID", isEqualTo: cardId)
					.whereField("actionType", isEqualTo: "swiped_left")
					.getDocuments { snap, err in
						if let err = err { promise(.failure(err)); return }
						let batch = self.firestore.batch()
						snap?.documents.forEach { batch.deleteDocument($0.reference) }
						batch.commit { batchErr in
							if let batchErr = batchErr { promise(.failure(batchErr)); return }
							let data: [String: Any] = [
								"userID": userId,
								"cardID": cardId,
								"actionType": "swiped_right",
								"cardState": stateStr,
								"timestamp": Timestamp(date: Date())
							]
							ref.document().setData(data) { err2 in
								err2 == nil ? promise(.success(())) : promise(.failure(err2!))
							}
						}
					}
			}
		}
		.eraseToAnyPublisher()
	}
}
