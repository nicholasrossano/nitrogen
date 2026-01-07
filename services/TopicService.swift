import FirebaseFirestore
import SDWebImage
import Combine

class TopicService {
    private let db = Firestore.firestore()

    func getTopics(display: Bool = true) -> AnyPublisher<[Topic], Error> {
        return Future { [weak self] promise in
            self?.db.collection("topics")
                .whereField("display", isEqualTo: display)
                .getDocuments { querySnapshot, error in
                    if let error = error {
                        promise(.failure(error))
                    } else {
                        let topics = querySnapshot?.documents.compactMap { doc -> Topic? in
                            Topic(from: doc)
                        } ?? []
                        promise(.success(topics))
                    }
                }
        }
        .eraseToAnyPublisher()
    }

    func sortTopics(_ topics: [Topic], favoriteStatuses: [String: Bool]) -> [Topic] {
        return topics.sorted { (topic1, topic2) -> Bool in
            let isFavorite1 = favoriteStatuses[topic1.id ?? ""] ?? false
            let isFavorite2 = favoriteStatuses[topic2.id ?? ""] ?? false

            if isFavorite1 == isFavorite2 {
                return topic1.name.localizedCaseInsensitiveCompare(topic2.name) == .orderedAscending
            } else {
                return isFavorite1 && !isFavorite2
            }
        }
    }

    func cacheTopics(_ topics: [Topic]) {
        let cacheKey = "topics_cache"
        do {
            let encoder = JSONEncoder()
            let data = try encoder.encode(topics)
            SDImageCache.shared.storeImageData(toDisk: data, forKey: cacheKey)
        } catch {
            print("Error caching topics: \(error)")
        }
    }

    func loadCachedTopics() -> [Topic]? {
        let cacheKey = "topics_cache"
        if let cachedData = SDImageCache.shared.diskImageData(forKey: cacheKey) {
            do {
                let decoder = JSONDecoder()
                return try decoder.decode([Topic].self, from: cachedData)
            } catch {
                print("Error decoding cached topics: \(error)")
            }
        }
        return nil
    }
}
