import Foundation
import FirebaseFirestore
import FirebaseAuth

final class ChatFeedbackService {
	static let shared = ChatFeedbackService()
	private let firestore = Firestore.firestore()
	private let auth = Auth.auth()
	
	private var currentUserId: String? { auth.currentUser?.uid }
	
	func submitFeedback(
		value: Int, // 1 = up, -1 = down
		message: ChatMessage,
		recentMessages: [ChatMessage],
		sessionID: String,
		conversationType: String,
		cardID: String?
	) {
		guard let userId = currentUserId else { return }
		
		let payload: [[String: Any]] = recentMessages.map { msg in
			[
				"id": msg.id.uuidString,
				"isUser": msg.isUser,
				"text": msg.text ?? makeNonTextLabel(for: msg)
			]
		}
		
		var doc: [String: Any] = [
			"userId": userId,
			"sessionID": sessionID,
			"conversationType": conversationType,
			"messageId": message.id.uuidString,
			"value": NSNumber(value: value),
			"label": (value == 1 ? "up" : "down"),
			"timestamp": FieldValue.serverTimestamp(),
			"messages": payload,
			"appVersion": (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? ""
		]
		if let cardID { doc["cardID"] = cardID }
		if let t = message.text, !t.isEmpty { doc["messageText"] = t }
		
		firestore.collection("feedbackCurator").addDocument(data: doc) { error in
			if let error { print("🛑 ChatFeedbackService:", error.localizedDescription) }
		}
	}
	
	private func makeNonTextLabel(for msg: ChatMessage) -> String {
		if msg.video != nil      { return "[video]"      }
		if msg.image != nil      { return "[image]"      }
		if msg.track != nil      { return "[music]"      }
		if msg.movie != nil      { return "[movie]"      }
		if msg.book != nil       { return "[book]"       }
		if msg.restaurant != nil { return "[restaurant]" }
		if msg.stock != nil      { return "[stock]"      }
		return "[unknown]"
	}
}
