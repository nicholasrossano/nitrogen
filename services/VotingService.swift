import Combine
import FirebaseFirestore
import FirebaseAuth

class VotingService: ObservableObject {
    private let votesCollection = Firestore.firestore().collection("votes")
    private let featureRequestsCollection = Firestore.firestore().collection("featureRequests")
    
    // Use Firebase Auth directly for the current user ID
    private var currentUserId: String? {
        return Auth.auth().currentUser?.uid
    }
    
    func voteForFeature(featureId: String) -> AnyPublisher<Void, Error> {
        return Future { promise in
            guard let userId = self.currentUserId else {
                let error = NSError(domain: "VotingService",
                                    code: 0,
                                    userInfo: [NSLocalizedDescriptionKey: "No user logged in"])
                promise(.failure(error))
                return
            }
            
            let voteQuery = self.votesCollection
                .whereField("userID", isEqualTo: userId)
                .whereField("featureID", isEqualTo: featureId)
            
            voteQuery.getDocuments { snapshot, error in
                if let error = error {
                    promise(.failure(error))
                } else {
                    // If user has already voted, remove vote. Otherwise, add new vote.
                    if let voteDoc = snapshot?.documents.first {
                        self.votesCollection.document(voteDoc.documentID).delete { error in
                            if let error = error {
                                promise(.failure(error))
                            } else {
                                promise(.success(()))
                            }
                        }
                    } else {
                        self.votesCollection.addDocument(data: [
                            "userID": userId,
                            "featureID": featureId,
                            "timestamp": FieldValue.serverTimestamp()
                        ]) { error in
                            if let error = error {
                                promise(.failure(error))
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
    
    func countVotesForFeature(featureId: String) -> AnyPublisher<Int, Error> {
        return Future { promise in
            self.votesCollection
                .whereField("featureID", isEqualTo: featureId)
                .getDocuments { snapshot, error in
                    if let error = error {
                        promise(.failure(error))
                    } else {
                        let voteCount = snapshot?.documents.count ?? 0
                        promise(.success(voteCount))
                    }
                }
        }
        .eraseToAnyPublisher()
    }
    
    func hasUserVotedForFeature(featureId: String) -> AnyPublisher<Bool, Error> {
        return Future { promise in
            guard let userId = self.currentUserId else {
                let error = NSError(domain: "VotingService",
                                    code: 0,
                                    userInfo: [NSLocalizedDescriptionKey: "No user logged in"])
                promise(.failure(error))
                return
            }
            
            self.votesCollection
                .whereField("userID", isEqualTo: userId)
                .whereField("featureID", isEqualTo: featureId)
                .getDocuments { snapshot, error in
                    if let error = error {
                        promise(.failure(error))
                    } else {
                        let hasVoted = !(snapshot?.documents.isEmpty ?? true)
                        promise(.success(hasVoted))
                    }
                }
        }
        .eraseToAnyPublisher()
    }
    
    func requestFeature(title: String, description: String) -> AnyPublisher<Void, Error> {
        return Future { promise in
            guard let userId = self.currentUserId else {
                let error = NSError(domain: "VotingService",
                                    code: 0,
                                    userInfo: [NSLocalizedDescriptionKey: "No user logged in"])
                promise(.failure(error))
                return
            }
            
            self.featureRequestsCollection.addDocument(data: [
                "userID": userId,
                "title": title,
                "description": description,
                "timestamp": FieldValue.serverTimestamp()
            ]) { error in
                if let error = error {
                    promise(.failure(error))
                } else {
                    promise(.success(()))
                }
            }
        }
        .eraseToAnyPublisher()
    }
}
