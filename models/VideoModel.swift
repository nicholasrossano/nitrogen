import Foundation

struct Video {
	let id: String
	let title: String
	let description: String
	let thumbnailURL: URL
	let videoURL: URL
	let category: VideoCategory
	var embeddable: Bool = true
}

public enum VideoCategory: String {
	case music = "10"
	case filmAndAnimation = "1"
	case other = ""
}
