import FirebaseFirestore
import FirebaseAuth
import Combine

class BookmarksService {
	private let db = Firestore.firestore()
	
	private var currentUserId: String? {
		return Auth.auth().currentUser?.uid
	}
	
	func isCardBookmarked(cardId: String, completion: @escaping (Bool) -> Void) {
		guard let userId = currentUserId else {
			completion(false)
			return
		}
		let docRef = db.collection("users").document(userId)
		docRef.getDocument { snapshot, _ in
			if let data = snapshot?.data(),
			   let bookmarks = data["bookmarkedCards"] as? [[String: Any]] {
				let isBookmarked = bookmarks.contains { $0["cardId"] as? String == cardId }
				completion(isBookmarked)
			} else {
				completion(false)
			}
		}
	}
	
	func addBookmark(cardId: String,
					 dateAdded: Date,
					 completion: @escaping (Bool) -> Void)
	{
		guard let userId = currentUserId else { completion(false); return }
		let docRef = db.collection("users").document(userId)
		
		db.runTransaction({ (txn, errorPointer) -> Any? in
			var bookmarks = (try? txn.getDocument(docRef)
				.data()?["bookmarkedCards"] as? [[String: Any]]) ?? []
			
			let exists = bookmarks.contains { $0["cardId"] as? String == cardId }
			if !exists {
				bookmarks.append([
					"cardId": cardId,
					"dateAdded": Timestamp(date: dateAdded)
				])
				txn.updateData(["bookmarkedCards": bookmarks], forDocument: docRef)
			}
			return nil
		}) { _, err in
			completion(err == nil)
		}
	}
	
	func removeBookmark(cardId: String, completion: @escaping (Bool) -> Void) {
		guard let userId = currentUserId else {
			completion(false)
			return
		}
		let docRef = db.collection("users").document(userId)
		
		db.runTransaction({ (transaction, errorPointer) -> Any? in
			do {
				let snapshot = try transaction.getDocument(docRef)
				guard var data = snapshot.data(),
					  var bookmarks = data["bookmarkedCards"] as? [[String: Any]] else {
					return nil
				}
				bookmarks.removeAll { $0["cardId"] as? String == cardId }
				transaction.updateData(["bookmarkedCards": bookmarks], forDocument: docRef)
			} catch {
				errorPointer?.pointee = error as NSError
				return nil
			}
			return nil
		}) { (_, error) in
			if let error = error {
				print("Failed to remove bookmark transaction: \(error.localizedDescription)")
				completion(false)
			} else {
				completion(true)
			}
		}
	}
	
	func getBookmarkedCards() -> AnyPublisher<[(cardId: String, dateAdded: Date)], Error> {
		guard let userId = currentUserId else {
			return Fail(error: NSError(
				domain: "BookmarksService",
				code: 0,
				userInfo: [NSLocalizedDescriptionKey: "User not logged in"]
			))
			.eraseToAnyPublisher()
		}
		
		return Future { promise in
			let docRef = self.db.collection("users").document(userId)
			
			func parse(_ snapshot: DocumentSnapshot?) -> [(String, Date)] {
				let dicts = snapshot?.data()?["bookmarkedCards"] as? [[String: Any]] ?? []
				let items: [(String, Date)] = dicts.compactMap { d in
					guard let id = d["cardId"] as? String else { return nil }
					guard let date = self.parseBookmarkDate(d["dateAdded"]) else { return nil }
					return (id, date)
				}
				return items
			}
			
			docRef.getDocument(source: .server) { snapshot, error in
				if error != nil {
					docRef.getDocument { fallbackSnapshot, fallbackError in
						if let fallbackError {
							promise(.failure(fallbackError))
							return
						}
						promise(.success(parse(fallbackSnapshot)))
					}
					return
				}
				promise(.success(parse(snapshot)))
			}
		}
		.eraseToAnyPublisher()
	}
	
	// ─────────── Section Header ───────────
	private func parseBookmarkDate(_ raw: Any?) -> Date? {
		if let ts = raw as? Timestamp { return ts.dateValue() }
		if let d  = raw as? Date { return d }
		if let dbl = raw as? Double { return Date(timeIntervalSince1970: dbl) }
		if let num = raw as? NSNumber { return Date(timeIntervalSince1970: num.doubleValue) }
		if let str = raw as? String, let dbl = Double(str) { return Date(timeIntervalSince1970: dbl) }
		return nil
	}
}
