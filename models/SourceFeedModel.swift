import SwiftUI
import FirebaseFirestore

struct SourceFeed: Identifiable, Codable {
    @DocumentID var id: String?
    var name: String
    var url: String
    var iconUrl: String?
}
