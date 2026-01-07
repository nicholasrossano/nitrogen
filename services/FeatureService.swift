import Combine
import FirebaseFirestore

class FeatureService {
    private let db = Firestore.firestore()
    private let featuresCollection = Firestore.firestore().collection("features")
    
    func getFeatures(display: Bool) -> AnyPublisher<[Feature], Error> {
        return Future { promise in
            self.featuresCollection
                .whereField("display", isEqualTo: display)
                .getDocuments { snapshot, error in
                    if let error = error {
                        promise(.failure(error))
                    } else {
                        var features: [Feature] = []
                        snapshot?.documents.forEach { document in
                            if let feature = try? document.data(as: Feature.self) {
                                // Firestore assigns the document ID separately
                                var item = feature
                                item.id = document.documentID
                                features.append(item)
                            }
                        }
                        promise(.success(features))
                    }
                }
        }
        .eraseToAnyPublisher()
    }
}
