import Foundation

struct Domain: Identifiable, Codable, Equatable {
	let id: String
	let name: String
	let display: Bool
	let categoryLabel: String
	let categories: [DomainCategory]
	let imageUrl: String?
}

struct DomainCategory: Codable, Equatable {
	let id: String
	let name: String
}
