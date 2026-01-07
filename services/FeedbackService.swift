import Foundation
import FirebaseFirestore
import FirebaseStorage
import Combine

class FeedbackService {
    private let firestore = Firestore.firestore()
    private let storage = Storage.storage()

    func uploadFile(image: UIImage) -> AnyPublisher<String?, Error> {
        return Future { promise in
            guard let imageData = image.jpegData(compressionQuality: 0.8) else {
                promise(.success(nil))
                return
            }

            let fileName = "feedback/\(Int(Date().timeIntervalSince1970)).jpg"
            let storageRef = self.storage.reference().child(fileName)
            let metadata = StorageMetadata()
            metadata.contentType = "image/jpeg"

            storageRef.putData(imageData, metadata: metadata) { metadata, error in
                if let error = error {
                    promise(.failure(error))
                    return
                }
                storageRef.downloadURL { url, error in
                    if let error = error {
                        promise(.failure(error))
                    } else {
                        promise(.success(url?.absoluteString))
                    }
                }
            }
        }.eraseToAnyPublisher()
    }

    func submitFeedback(title: String, description: String, imageUrl: String?) -> AnyPublisher<Void, Error> {
        return Future { promise in
            var data: [String: Any] = [
                "title": title,
                "description": description,
                "timestamp": FieldValue.serverTimestamp()
            ]
            if let imageUrl = imageUrl {
                data["image_url"] = imageUrl
            }
            self.firestore.collection("feedback").addDocument(data: data) { error in
                if let error = error {
                    promise(.failure(error))
                } else {
                    promise(.success(()))
                }
            }
        }.eraseToAnyPublisher()
    }
}
