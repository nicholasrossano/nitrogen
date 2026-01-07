import SwiftUI
import FirebaseAnalytics
import SDWebImageSwiftUI
import SafariServices
import UIKit

struct SourceBox: View {
	let source : Source
	let index  : Int
	let cardId : String
	@EnvironmentObject var servicesLocator: AppServicesLocator
	
	private var screenWidth : CGFloat { UIScreen.main.bounds.width }
	private var circleSize  : CGFloat { screenWidth * 0.07 }
	private var fontSize    : CGFloat { screenWidth * 0.028 }
	private var cornerRadius: CGFloat { screenWidth * 0.04  }
	private var linkURL     : URL?     { URL(string: source.url ?? "") }
	
	var body: some View {
		Group {
			if
				let iconUrl = source.iconUrl,
				!iconUrl.isEmpty,
				let url = URL(string: iconUrl)
			{
				WebImage(url: url)
					.resizable()
					.aspectRatio(contentMode: .fill)
					.frame(width: circleSize, height: circleSize)
					.clipShape(Circle())
			} else {
				Text(source.name ?? "Unknown Source")
					.font(.custom("Avenir", size: fontSize))
					.foregroundColor(.black)
					.padding(.horizontal, screenWidth * 0.025)
					.padding(.vertical, screenWidth * 0.015)
					.frame(height: circleSize)
					.background(Color.white.opacity(0.7))
					.clipShape(
						RoundedRectangle(
							cornerRadius: cornerRadius,
							style: .continuous
						)
					)
			}
		}
		.frame(height: circleSize)
		.onTapGesture(perform: openLink)
		.contextMenu {
			Button("Open Source") { openLink() }
		} preview: {
			if let previewURL = linkURL {
				SafariView(url: previewURL)
			} else {
				Text("Unable to preview").padding()
			}
		}
		.sheet(item: $safariURL) { url in SafariView(url: url) }
	}
	
	@State private var safariURL: URL?
	
	private func openLink() {
		guard let link = source.url, let url = URL(string: link) else { return }
		safariURL = url
		
		let domain = normalizedDomain(from: url)
		let name   = (source.name ?? domain)
		Analytics.logEvent("source_open", parameters: [
			"card_id": cardId as NSString,
			"source_name": name as NSString,
			"domain": domain as NSString,
			"position": NSNumber(value: index)
		])
	}
	
	private func normalizedDomain(from url: URL) -> String {
		var host = (url.host ?? "").lowercased()
		if host.hasPrefix("www.") { host.removeFirst(4) }
		return host
	}
}
