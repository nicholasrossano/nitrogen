import Foundation

struct PodcastChapter: Codable, Equatable {
	let title: String?
	let startSeconds: Double?
	let endSeconds: Double?
}

struct MusicMetadata: Codable, Equatable {
	let song: String?
	let artist: String?
	let album: String?
	let artworkURL: URL?
	let previewURL: URL?
	let spotifyURL: URL?
	let appleMusicURL: URL?
	let videoURL: URL?
	let videoPosterURL: URL?
	
	let highlightStartSeconds: Double?
	let highlightDurationSeconds: Double?
	let chapters: [PodcastChapter]?
	let transcriptURL: URL?
	
	init(song: String? = nil,
		 artist: String? = nil,
		 album: String? = nil,
		 artworkURL: URL? = nil,
		 previewURL: URL? = nil,
		 spotifyURL: URL? = nil,
		 appleMusicURL: URL? = nil,
		 videoURL: URL? = nil,
		 videoPosterURL: URL? = nil,
		 highlightStartSeconds: Double? = nil,
		 highlightDurationSeconds: Double? = nil,
		 chapters: [PodcastChapter]? = nil,
		 transcriptURL: URL? = nil) {
		self.song = song
		self.artist = artist
		self.album = album
		self.artworkURL = artworkURL
		self.previewURL = previewURL
		self.spotifyURL = spotifyURL
		self.appleMusicURL = appleMusicURL
		self.videoURL = videoURL
		self.videoPosterURL = videoPosterURL
		self.highlightStartSeconds = highlightStartSeconds
		self.highlightDurationSeconds = highlightDurationSeconds
		self.chapters = chapters
		self.transcriptURL = transcriptURL
	}
	
	init(fromJson json: [String: Any]) {
		self.song = json["song"] as? String
		self.artist = json["artist"] as? String
		self.album = json["album"] as? String
		
		if let s = json["artworkURL"] as? String { self.artworkURL = URL(string: s) } else { self.artworkURL = nil }
		if let s = json["previewURL"] as? String { self.previewURL = URL(string: s) } else { self.previewURL = nil }
		if let s = json["spotifyURL"] as? String { self.spotifyURL = URL(string: s) } else { self.spotifyURL = nil }
		if let s = json["appleMusicURL"] as? String { self.appleMusicURL = URL(string: s) } else { self.appleMusicURL = nil }
		if let s = json["videoURL"] as? String { self.videoURL = URL(string: s) } else { self.videoURL = nil }
		if let s = json["videoPosterURL"] as? String { self.videoPosterURL = URL(string: s) } else { self.videoPosterURL = nil }
		
		if let n = json["highlightStartSeconds"] as? NSNumber { self.highlightStartSeconds = n.doubleValue }
		else if let d = json["highlightStartSeconds"] as? Double { self.highlightStartSeconds = d }
		else { self.highlightStartSeconds = nil }
		
		if let n = json["highlightDurationSeconds"] as? NSNumber { self.highlightDurationSeconds = n.doubleValue }
		else if let d = json["highlightDurationSeconds"] as? Double { self.highlightDurationSeconds = d }
		else { self.highlightDurationSeconds = nil }
		
		if let chArr = json["chapters"] as? [[String: Any]] {
			self.chapters = chArr.map {
				PodcastChapter(
					title: $0["title"] as? String,
					startSeconds: ($0["startSeconds"] as? NSNumber)?.doubleValue ?? $0["startSeconds"] as? Double,
					endSeconds: ($0["endSeconds"] as? NSNumber)?.doubleValue ?? $0["endSeconds"] as? Double
				)
			}
		} else {
			self.chapters = nil
		}
		
		if let s = json["transcriptURL"] as? String { self.transcriptURL = URL(string: s) } else { self.transcriptURL = nil }
	}
}
