import FirebaseFirestore
import Foundation

class CardViewTracker: ObservableObject {
    private var startTimestamp: Date?
    private var currentCardID: String?
    
    private let servicesLocator: AppServicesLocator

    init(servicesLocator: AppServicesLocator) {
        self.servicesLocator = servicesLocator
    }

    func startTracking(cardID: String) {
        if currentCardID != cardID {
            stopTracking()
            currentCardID = cardID
            startTimestamp = Date()
        }
    }

    func stopTracking() {
        guard let start = startTimestamp, let cardID = currentCardID else { return }
        let timeSpent = Date().timeIntervalSince(start)

        guard timeSpent > 1.0 else {
            print("Skipping logging: view was too short (\(timeSpent)s)")
            return
        }

        guard let userId = servicesLocator.userService.getUserId() else { return }

        let userActionsRef = Firestore.firestore().collection("userActions")
        let cardRef = userActionsRef.document("\(userId)_\(cardID)")

        cardRef.getDocument { document, error in
            if let doc = document, doc.exists {
                cardRef.updateData([
                    "totalTimeSpent": FirebaseFirestore.FieldValue.increment(timeSpent),
                    "viewCount": FirebaseFirestore.FieldValue.increment(Int64(1)),
                    "lastViewed": FirebaseFirestore.FieldValue.serverTimestamp()
                ])
            } else {
                cardRef.setData([
                    "actionType": "viewed_card",
                    "cardID": cardID,
                    "userID": userId,
                    "totalTimeSpent": timeSpent,
                    "viewCount": 1,
                    "lastViewed": FirebaseFirestore.FieldValue.serverTimestamp()
                ])
            }
        }

        // Reset tracking
        currentCardID = nil
        startTimestamp = nil
    }
}
