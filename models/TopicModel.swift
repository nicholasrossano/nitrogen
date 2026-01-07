import FirebaseFirestore

struct Topic: Identifiable, Equatable, Encodable, Decodable {
    let id: String?
    let name: String
    let imageUrl: String
    let description: String
    let category: String?
    let categoryId: Int?
    let display: Bool?

    var identifier: String {
        return id ?? UUID().uuidString
    }

    init(name: String, imageUrl: String, description: String, id: String? = nil, category: String? = nil, categoryId: Int? = nil, display: Bool? = nil) {
        self.name = name
        self.imageUrl = imageUrl
        self.description = description
        self.id = id
        self.category = category
        self.categoryId = categoryId
        self.display = display
    }

    init(from document: DocumentSnapshot) {
        let data = document.data() ?? [:]
        self.id = document.documentID
        self.name = data["topic"] as? String ?? ""
        self.imageUrl = data["imageUrl"] as? String ?? ""
        self.description = data["description"] as? String ?? ""
        self.category = data["category"] as? String
        self.categoryId = data["categoryId"] as? Int
        self.display = data["display"] as? Bool
    }

    init(fromJson json: [String: Any]) {
        self.id = json["id"] as? String
        self.name = json["name"] as? String ?? ""
        self.imageUrl = json["imageUrl"] as? String ?? ""
        self.description = json["description"] as? String ?? ""
        self.category = json["category"] as? String
        self.categoryId = json["categoryId"] as? Int
        self.display = json["display"] as? Bool
    }

    func toJson() -> [String: Any] {
        return [
            "id": id as Any,
            "name": name,
            "imageUrl": imageUrl,
            "description": description,
            "category": category as Any,
            "categoryId": categoryId as Any,
            "display": display as Any
        ]
    }

    static func == (lhs: Topic, rhs: Topic) -> Bool {
        return lhs.id == rhs.id &&
               lhs.name == rhs.name &&
               lhs.imageUrl == rhs.imageUrl &&
               lhs.description == rhs.description &&
               lhs.category == rhs.category &&
               lhs.categoryId == rhs.categoryId &&
               lhs.display == rhs.display
    }
}
