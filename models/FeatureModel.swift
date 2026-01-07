import Foundation

struct Feature: Identifiable, Codable, Equatable {
    var id: String?
    var title: String
    var description: String
    var display: Bool
    var status: String
}
