import FirebaseFirestore
import FirebaseAuth
import Combine

class FavoritesService {
    private let firestore = Firestore.firestore()
    private let auth = Auth.auth()

    func toggleFavorite(topicId: String) -> AnyPublisher<Void, Error> {
        guard let user = auth.currentUser else {
            return Fail(error: NSError(domain: "FavoritesService", code: 0, userInfo: [NSLocalizedDescriptionKey: "No user logged in"]))
                .eraseToAnyPublisher()
        }

        let userRef = firestore.collection("users").document(user.uid)
        print("Toggling favorite for user ID: \(user.uid) and topic ID: \(topicId)")

        return Future { promise in
            userRef.getDocument { document, error in
                if let error = error {
                    print("Error getting document: \(error.localizedDescription)")
                    promise(.failure(error))
                } else if let document = document, document.exists {
                    var favoriteTopics = document.data()?["favoriteTopicIds"] as? [String] ?? []
                    if favoriteTopics.contains(topicId) {
                        favoriteTopics.removeAll { $0 == topicId }
                    } else {
                        favoriteTopics.append(topicId)
                    }
                    print("Updated favoriteTopics: \(favoriteTopics)")

                    userRef.updateData(["favoriteTopicIds": favoriteTopics]) { error in
                        if let error = error {
                            print("Error updating document: \(error.localizedDescription)")
                            promise(.failure(error))
                        } else {
                            print("Successfully updated favorites")
                            promise(.success(()))
                        }
                    }
                } else {
                    print("Document does not exist")
                    promise(.failure(NSError(domain: "Document does not exist", code: 0, userInfo: nil)))
                }
            }
        }
        .eraseToAnyPublisher()
    }

    func fetchFavorites() -> AnyPublisher<[String], Error> {
        guard let user = auth.currentUser else {
            return Fail(error: NSError(domain: "FavoritesService", code: 0, userInfo: [NSLocalizedDescriptionKey: "No user logged in"]))
                .eraseToAnyPublisher()
        }

        let userRef = firestore.collection("users").document(user.uid)
        print("Fetching favorites for user ID: \(user.uid)")

        return Future { promise in
            userRef.getDocument { document, error in
                if let error = error {
                    print("Error fetching document: \(error.localizedDescription)")
                    promise(.failure(error))
                } else {
                    let favorites = document?.data()?["favoriteTopicIds"] as? [String] ?? []
                    print("Fetched favorites: \(favorites)")
                    promise(.success(favorites))
                }
            }
        }
        .eraseToAnyPublisher()
    }
}
