import Foundation

struct ResearchMetadata: Codable, Equatable {
	let images: [ImageAsset]?
	let journalCoverURL: String?
	let journalLogoURL: String?
	
	private enum CodingKeys: String, CodingKey {
		case images
		case journalCoverURL = "journal_cover_url"
		case journalLogoURL  = "journal_logo_url"
	}
	
	struct ImageAsset: Codable, Equatable {
		let url: String?
		let pageURL: String?
		let caption: String?
		let credit: String?
		let license: String?
		let sourceHost: String?
		
		private enum CodingKeys: String, CodingKey {
			case url
			case pageURL     = "page_url"
			case caption
			case credit
			case license
			case sourceHost  = "source_host"
		}
	}
}
