import SwiftUI
import Combine

struct RequestFeaturePopup: View {
	@Binding var isPresented: Bool
	@State private var featureTitle: String = ""
	@State private var featureDescription: String = ""
	@ObservedObject var viewModel: VotingViewModel
	@State private var showCheckmark = false
	@State private var contentOpacity: Double = 1
	@State private var errorMessage: String?
	@Environment(\.colorScheme) private var colorScheme        // ← used for depth tweaks
	
	var body: some View {
		ZStack {
			if isPresented {
				Color.black.opacity(0.3)
					.ignoresSafeArea()
				
				GeometryReader { geo in
					ZStack {
						// -------- depth & background --------
						RoundedRectangle(cornerRadius: 16, style: .continuous)
							.fill(Color(.systemBackground))
							.overlay(                              // highlight edge in dark mode
								RoundedRectangle(cornerRadius: 16, style: .continuous)
									.stroke(Color.white.opacity(colorScheme == .dark ? 0.2 : 0),
											lineWidth: 1)
							)
							.shadow(                               // beefier shadow in dark
								color: Color.black.opacity(colorScheme == .dark ? 0.8 : 0.25),
								radius: 20,
								x: 0,
								y: 10
							)
						
						// -------- popup content --------
						VStack(spacing: 16) {
							HStack {
								Button {
									isPresented = false
								} label: {
									Image(systemName: "xmark")
										.font(.system(size: 16, weight: .bold))
										.foregroundColor(.accentSecondary)
								}
								Spacer()
							}
							.padding(.horizontal, 16)
							.padding(.top, 16)
							
							Text("Request a Feature")
								.font(.custom("Avenir", size: 20))
								.fontWeight(.medium)
								.padding(.bottom, 8)
							
							HStack(spacing: 16) {
								Text("Title:")
									.font(.custom("Avenir", size: 16))
								TextField("", text: $featureTitle)
									.font(.custom("Avenir", size: 16))
									.padding(.bottom, 4)
									.background(
										Rectangle()
											.fill(Color(.separator))
											.frame(height: 1)
											.offset(y: 6),
										alignment: .bottom
									)
							}
							.padding(.horizontal, 16)
							.padding(.bottom, 16)
							
							VStack(alignment: .leading, spacing: 4) {
								Text("Description:")
									.font(.custom("Avenir", size: 16))
								
								TextField("", text: $featureDescription)
									.font(.custom("Avenir", size: 16))
									.padding(.bottom, 4)
									.background(
										Rectangle()
											.fill(Color(.separator))
											.frame(height: 1)
											.offset(y: 6),
										alignment: .bottom
									)
							}
							.padding(.horizontal, 16)
							
							if let error = errorMessage {
								Text(error)
									.foregroundColor(.red)
									.font(.custom("Avenir", size: 14))
							}
							
							Spacer()
							
							Button(action: submitFeatureRequest) {
								Text("Submit")
									.font(.custom("Avenir", size: 16))
									.fontWeight(.medium)
									.frame(width: 120)
									.padding(.vertical, 10)
									.background(featureTitle.isEmpty ? Color(.systemGray3) : Color.accentPrimary)
									.foregroundColor(.white)
									.cornerRadius(25)
							}
							.disabled(featureTitle.isEmpty)
							.padding(.bottom, 20)
						}
						.opacity(contentOpacity)
						
						if showCheckmark {
							Image(systemName: "checkmark.circle.fill")
								.foregroundColor(.green)
								.font(.system(size: 60))
								.transition(.opacity)
						}
					}
					.frame(width: geo.size.width * 0.75,
						   height: geo.size.height * 0.4)
					.position(x: geo.size.width / 2,
							  y: geo.size.height / 2)
				}
			}
		}
	}
	
	// MARK: - Actions
	private func submitFeatureRequest() {
		guard !featureTitle.isEmpty else {
			errorMessage = "Please provide a title."
			return
		}
		
		errorMessage = nil
		viewModel.requestFeature(title: featureTitle, description: featureDescription)
		showSuccessAnimation()
	}
	
	private func showSuccessAnimation() {
		UIImpactFeedbackGenerator(style: .medium).impactOccurred()
		
		withAnimation(.easeInOut(duration: 0.3)) { contentOpacity = 0 }
		
		DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
			withAnimation(.easeInOut(duration: 0.3)) { showCheckmark = true }
		}
		
		DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
			withAnimation(.easeInOut(duration: 0.3)) {
				showCheckmark = false
				isPresented = false
			}
		}
	}
}
