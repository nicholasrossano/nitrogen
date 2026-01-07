import FirebaseFirestore
import FirebaseAuth
import Combine
import Foundation

class ReportService {
	private let firestore = Firestore.firestore()
	private var cachedDomains: [(id: String, name: String)]?
	
	private var currentUserId: String? {
		return Auth.auth().currentUser?.uid
	}
	
	func submitReport(cardId: String, reasonId: String, comment: String) -> AnyPublisher<Void, Error> {
		return Future { [weak self] promise in
			guard let self = self else { return }
			
			guard let userId = self.currentUserId else {
				let error = NSError(domain: "ReportService",
									code: 0,
									userInfo: [NSLocalizedDescriptionKey: "No user logged in"])
				promise(.failure(error))
				return
			}
			
			let userRef = self.firestore.collection("users").document(userId)
			userRef.getDocument { document, error in
				if let error = error {
					promise(.failure(error))
					return
				}
				
				let role = document?.data()?["role"] as? String ?? "user"
				let isPrivileged = (role == "admin" || role == "tester")
				
				let reportData: [String: Any] = [
					"userId": userId,
					"cardId": cardId,
					"reason": reasonId,
					"comment": comment,
					"timestamp": FieldValue.serverTimestamp()
				]
				
				self.firestore.collection("reports").addDocument(data: reportData) { error in
					if let error = error {
						promise(.failure(error))
					} else {
						self.updateFinetuningLogs(cardId: cardId, reasonId: reasonId, comment: comment) { error in
							if let error = error {
								promise(.failure(error))
							} else if isPrivileged {
								self.updateCardStatus(cardId: cardId, reasonId: reasonId, comment: comment) { error in
									if let error = error {
										promise(.failure(error))
									} else {
										promise(.success(()))
									}
								}
							} else {
								promise(.success(()))
							}
						}
					}
				}
			}
		}
		.eraseToAnyPublisher()
	}
	
	// ─────────── Card status update routing ───────────
	private func updateCardStatus(cardId: String, reasonId: String, comment: String, completion: @escaping (Error?) -> Void) {
		let cardRef = firestore.collection("cards").document(cardId)
		
		if reasonId == "toggle_spoiler" {
			toggleSpoiler(cardRef: cardRef, completion: completion)
			return
		}
		
		if reasonId == "fix_request" {
			completion(nil)
			return
		}
		
		if reasonId == "widget_irrelevant" {
			cardRef.updateData([
				"isWidgetDisabled": true
			], completion: completion)
			return
		}
		
		if reasonId == "topic_misclassification" {
			recategorizeDomain(cardRef: cardRef, comment: comment, completion: completion)
			return
		}
		
		if reasonId == "dislike_content" {
			completion(nil)
			return
		}
		
		let derivation = deriveManualSubcode(reasonId: reasonId, comment: comment)
		if derivation.reject, let subcode = derivation.subcode {
			cardRef.updateData([
				"reasonCode": "MANUAL_\(subcode)",
				"status": "rejected"
			], completion: completion)
			return
		}
		
		completion(nil)
	}
	
	private func recategorizeDomain(cardRef: DocumentReference, comment: String, completion: @escaping (Error?) -> Void) {
		let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else {
			rejectForTopicMisclassification(cardRef: cardRef, completion: completion)
			return
		}
		
		if let cachedDomains, let match = findDomainMatch(in: cachedDomains, input: trimmed) {
			applyDomain(match, to: cardRef, completion: completion)
			return
		}
		
		firestore.collection("domains").getDocuments { [weak self] snapshot, _ in
			guard let self = self else { return }
			
			let domains: [(id: String, name: String)] = snapshot?.documents.compactMap { doc in
				guard let name = doc.data()["name"] as? String else { return nil }
				return (id: doc.documentID, name: name)
			} ?? []
			
			if !domains.isEmpty {
				self.cachedDomains = domains
			}
			
			if let match = self.findDomainMatch(in: domains, input: trimmed) {
				self.applyDomain(match, to: cardRef, completion: completion)
			} else {
				self.rejectForTopicMisclassification(cardRef: cardRef, completion: completion)
			}
		}
	}
	
	private func findDomainMatch(in domains: [(id: String, name: String)], input: String) -> (id: String, name: String)? {
		let lower = input.lowercased()
		return domains.first {
			$0.id.lowercased() == lower || $0.name.lowercased() == lower
		}
	}
	
	private func applyDomain(_ domain: (id: String, name: String), to cardRef: DocumentReference, completion: @escaping (Error?) -> Void) {
		cardRef.updateData([
			"enrichedMetadata.domain": [
				"id": domain.id,
				"name": domain.name
			]
		], completion: completion)
	}
	
	private func rejectForTopicMisclassification(cardRef: DocumentReference, completion: @escaping (Error?) -> Void) {
		cardRef.updateData([
			"reasonCode": "MANUAL_TOPIC_MISCLASSIFICATION",
			"status": "rejected"
		], completion: completion)
	}
	
	private func toggleSpoiler(cardRef: DocumentReference, completion: @escaping (Error?) -> Void) {
		firestore.runTransaction({ transaction, errorPointer in
			do {
				let snapshot = try transaction.getDocument(cardRef)
				let data = snapshot.data() ?? [:]
				let current = (data["spoiler"] as? Bool) ?? false
				transaction.updateData(["spoiler": !current], forDocument: cardRef)
			} catch let error as NSError {
				errorPointer?.pointee = error
				return nil
			}
			return nil
		}) { _, error in
			completion(error)
		}
	}
	
	// ─────────── Finetuning logs ───────────
	private func updateFinetuningLogs(cardId: String, reasonId: String, comment: String, completion: @escaping (Error?) -> Void) {
		let clientTimestamp = Timestamp(date: Date())
		let logRef = firestore.collection("finetuningLogs").document(cardId)
		
		let newReport: [String: Any] = [
			"reason": reasonId,
			"comment": comment,
			"timestamp": clientTimestamp
		]
		
		let updates: [String: Any] = [
			"userReports": FieldValue.arrayUnion([newReport])
		]
		
		logRef.getDocument { document, error in
			if let error = error {
				completion(error)
			} else if let document = document, document.exists {
				logRef.updateData(updates, completion: completion)
			} else {
				logRef.setData([
					"userReports": [newReport]
				], completion: completion)
			}
		}
	}
	
	// ─────────── Subcode derivation ───────────
	private func deriveManualSubcode(reasonId: String, comment: String) -> (subcode: String?, reject: Bool) {
		switch reasonId {
		case "inappropriate_or_harmful":
			return ("INAPPROPRIATE", true)
		case "inaccurate_or_low_quality":
			return ("INACCURATE_OR_LOW_QUALITY", true)
		case "irrelevant_cluster":
			return ("IRRELEVANT_CLUSTER", true)
		case "other":
			return deriveFromOther(comment: comment)
		default:
			return (nil, false)
		}
	}
	
	// ─────────── “Other” comment mapping ───────────
	private func deriveFromOther(comment: String) -> (subcode: String?, reject: Bool) {
		let text = comment.lowercased()
		
		if matches(text, pattern: #"\bduplicate\b|\bdupe\b|already\s*(posted|covered)"#) {
			return ("DUPLICATE", true)
		}
		if matches(text, pattern: #"plagiar|cop(y|ied)|too\s+similar"#) {
			return ("PLAGIARISM", true)
		}
		if matches(text, pattern: #"404|403|410|dead\s+link|broken\s+link|removed|redirect.*home|invalid\s*url|paywall|subscriber[- ]only"#) {
			return ("SOURCE_ISSUE", true)
		}
		if matches(text, pattern: #"outdated|\bold\b|stale|superseded|no\s+longer\s+current"#) {
			return ("OUTDATED", true)
		}
		if matches(text, pattern: #"not\s+newsworthy|no\s+news\s+value|doesn[’']t\s+matter|who\s+cares"#) {
			return ("NOT_NEWSWORTHY", true)
		}
		
		return (nil, false)
	}
	
	// ─────────── Regex helper ───────────
	private func matches(_ text: String, pattern: String) -> Bool {
		do {
			let regex = try NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
			let range = NSRange(text.startIndex..<text.endIndex, in: text)
			return regex.firstMatch(in: text, options: [], range: range) != nil
		} catch {
			return false
		}
	}
}
