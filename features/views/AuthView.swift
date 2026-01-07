import SwiftUI
import _AuthenticationServices_SwiftUI
import FirebaseAuth
import Combine
import SDWebImageSwiftUI
import FirebaseAnalytics

struct AuthView: View {
	
	private enum Stage { case intro, signin }
	@State private var stage: Stage = {
		UserDefaults.standard.bool(forKey: "hasSeenIntro") ? .signin : .intro
	}()
	
	@EnvironmentObject var servicesLocator: AppServicesLocator
	@StateObject private var viewModel = AuthViewModel()
	
	@State private var op1 = 0.0
	@State private var op2 = 0.0
	@State private var op3 = 0.0
	@State private var titleOpacity  = 0.0
	@State private var buttonOpacity = 0.0
	@State private var blurOpacity   = UserDefaults.standard.bool(forKey: "hasSeenIntro") ? 0.0 : 1.0
	
	// ─────────── Section Header ───────────
	@State private var orbitProgress: CGFloat = 0.0
	@State private var orbitAngle: Double = -32.0
	@State private var orbitScale: CGFloat = 0.94
	
	var body: some View {
		ZStack {
			LoopingVideoPlayer(videoName: "LoginVideo-Foreword2", videoType: "mp4")
				.ignoresSafeArea()
			
			BlurView(style: .systemUltraThinMaterialDark, intensity: 0)
				.opacity(blurOpacity)
				.ignoresSafeArea()
			
			VStack {
				switch stage {
				case .intro:  introView
				case .signin: signinView
				}
			}
			.padding()
		}
		.navigationBarBackButtonHidden(true)
		.onChange(of: stage) { newStage in
			withAnimation(.easeInOut(duration: 0.8)) {
				blurOpacity = (newStage == .intro) ? 1 : 0
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: .userDidAuthenticate)) { _ in
			UserDefaults.standard.set(true, forKey: "hasSeenIntro")
		}
	}
	
	// ─────────── Section Header ───────────
	private var introView: some View {
		VStack {
			Spacer().frame(height: 80)
			
			Text("Foreword AI is your personal librarian for everything you're curious about.")
				.font(.custom("Avenir", size: 20))
				.foregroundColor(.white)
				.multilineTextAlignment(.center)
				.padding(.horizontal, 24)
				.opacity(op1)
			
			Spacer()
			
			Text("We scan for the latest books and their reviews, then summarize and compile them into bite-sized cards.")
				.font(.custom("Avenir", size: 20))
				.foregroundColor(.white)
				.multilineTextAlignment(.center)
				.padding(.horizontal, 24)
				.opacity(op2)
			
			Spacer()
			
			Text("Because technology should bring you closer to what you care about, not just deeper into an algorithm.")
				.font(.custom("Avenir", size: 20))
				.foregroundColor(.white)
				.multilineTextAlignment(.center)
				.padding(.horizontal, 24)
				.opacity(op3)
			
			Spacer().frame(height: 80)
		}
		.onAppear { runIntroSequence() }
	}
	
	// ─────────── Section Header ───────────
	private func runIntroSequence() {
		withAnimation(.linear(duration: 1.5)) { op1 = 1 }
		DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
			withAnimation(.linear(duration: 1.5)) { op2 = 1 }
			DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
				withAnimation(.linear(duration: 1.5)) { op3 = 1 }
				DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
					withAnimation(.easeInOut(duration: 1.5)) { stage = .signin }
				}
			}
		}
	}
	
	// ─────────── Section Header ───────────
	private var signinView: some View {
		let screenW = UIScreen.main.bounds.width
		
		return VStack {
			ZStack {
				OrbitRing(progress: orbitProgress)
					.frame(width: screenW * 0.7, height: screenW * 0.25)
					.scaleEffect(orbitScale)
					.rotationEffect(.degrees(orbitAngle))
					.offset(y: -4)
					.opacity(titleOpacity)
				
				Text("Foreword AI")
					.font(.custom("Didot-Italic", size: 36))
					.foregroundColor(.white)
					.opacity(titleOpacity)
			}
			.padding(.top, 60)
			
			Text("Your personal librarian")
				.font(.custom("Avenir", size: 16))
				.foregroundColor(.white.opacity(0.9))
				.opacity(titleOpacity)
				.padding(.top, 6)
			
			Spacer()
			
			SignInWithAppleButton(
				onRequest: viewModel.handleSignInWithAppleRequest,
				onCompletion: viewModel.handleSignInWithAppleCompletion
			)
			.signInWithAppleButtonStyle(.black)
			.frame(width: UIScreen.main.bounds.width * 0.6, height: 50)
			.cornerRadius(25)
			.opacity(buttonOpacity)
			
			Spacer().frame(height: 10)
			
			VStack(spacing: 4) {
				Link("Terms and Conditions",
					 destination: URL(string: "https://www.ponder-app.ai/terms-and-conditions")!)
				Link("Privacy Policy",
					 destination: URL(string: "https://www.ponder-app.ai/privacy-policy")!)
			}
			.font(.footnote)
			.foregroundColor(.white)
			.opacity(buttonOpacity)
		}
		.onAppear {
			withAnimation(.easeIn(duration: 1)) {
				titleOpacity  = 1
				buttonOpacity = 1
			}
			withAnimation(.easeOut(duration: 1.2).delay(0.5)) {
				orbitProgress = 1.0
			}
			withAnimation(.spring(response: 0.9, dampingFraction: 0.72, blendDuration: 0.2)) {
				orbitAngle = 12.0
				orbitScale = 1.0
			}
			Analytics.logEvent("auth_signin_view_shown", parameters: [
				"screen": "auth_signin" as NSString,
				"trigger": "auto" as NSString
			])
			Analytics.logEvent("auth_title_orbit_started", parameters: [
				"screen": "auth_signin" as NSString,
				"trigger": "on_appear" as NSString
			])
		}
	}
}

// ─────────── Section Header ───────────
private struct OrbitRing: View {
	let progress: CGFloat
	
	var body: some View {
		Ellipse()
			.trim(from: 0, to: progress)
			.stroke(Color.white.opacity(0.9),
					style: StrokeStyle(lineWidth: 1, lineCap: .round, lineJoin: .round))
			.rotationEffect(.degrees(-25))
			.contentShape(Rectangle())
	}
}
