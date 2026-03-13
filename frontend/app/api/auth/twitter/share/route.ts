import { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/api";
import { refreshTwitterToken } from "@/lib/twitter";

const TWITTER_UPLOAD_URL = "https://api.x.com/2/media/upload";
const TWITTER_TWEET_URL = "https://api.x.com/2/tweets";

export async function POST(request: NextRequest) {
	try {
		const formData = await request.formData();
		const image = formData.get("image") as Blob;
		const text = formData.get("text") as string;
		const walletAddress = formData.get("walletAddress") as string;

		if (!image || !text || !walletAddress) {
			return NextResponse.json(
				{ error: "Missing required fields" },
				{ status: 400 },
			);
		}

		const userResponse = await api.getUserProfile(walletAddress);
		const accessToken = userResponse?.user?.twitterAccessToken;
		const refreshToken = userResponse?.user?.twitterRefreshToken;
		const tokenExpiresAt = userResponse?.user?.twitterTokenExpiresAt;

		if (!accessToken) {
			return NextResponse.json(
				{ error: "Twitter not connected. Please link your account." },
				{ status: 401 },
			);
		}

		let currentAccessToken = accessToken;

		if (tokenExpiresAt) {
			const now = new Date();
			const expiresAt = new Date(tokenExpiresAt);

			if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
				const refreshed = await refreshTwitterToken(refreshToken ?? "");

				if (!refreshed) {
					return NextResponse.json(
						{ error: "Failed to refresh token. Please reconnect Twitter." },
						{ status: 401 },
					);
				}

				await api.updateTwitterTokens({
					walletAddress,
					accessToken: refreshed.accessToken,
					refreshToken: refreshed.refreshToken,
					expiresAt: new Date(
						Date.now() + refreshed.expiresIn * 1000,
					).toISOString(),
				});

				currentAccessToken = refreshed.accessToken;
			}
		}

		const imageBuffer = Buffer.from(await image.arrayBuffer());
		const base64Image = imageBuffer.toString("base64");

		const uploadResponse = await fetch(TWITTER_UPLOAD_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${currentAccessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				media: base64Image,
				media_category: "tweet_image",
				media_type: "image/png",
			}),
		});

		if (!uploadResponse.ok) {
			const errorText = await uploadResponse.text();
			console.error("Upload error response:", errorText);

			let errorData;
			try {
				errorData = JSON.parse(errorText);
			} catch {
				errorData = { message: errorText };
			}

			return NextResponse.json(
				{ error: `Media upload failed: ${JSON.stringify(errorData)}` },
				{ status: uploadResponse.status },
			);
		}

		const uploadData = await uploadResponse.json();
		if (uploadData.errors && uploadData.errors.length > 0) {
			console.error("Upload errors:", uploadData.errors);
			return NextResponse.json(
				{ error: `Media upload failed: ${JSON.stringify(uploadData.errors)}` },
				{ status: 400 },
			);
		}

		const mediaId = uploadData.data?.id;

		if (!mediaId) {
			console.error("Upload response missing media ID:", uploadData);
			throw new Error("No media ID returned from upload");
		}

		const cardUrl = `https://hashtro.fun`;

		const tweetResponse = await fetch(TWITTER_TWEET_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${currentAccessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				text: `${text}\n\n${cardUrl}`,
				media: {
					media_ids: [mediaId],
				},
			}),
		});

		if (!tweetResponse.ok) {
			const errorText = await tweetResponse.text();
			console.error("Tweet error response:", errorText);

			let errorData;
			try {
				errorData = JSON.parse(errorText);
			} catch {
				errorData = { message: errorText };
			}

			return NextResponse.json(
				{ error: `Tweet creation failed: ${JSON.stringify(errorData)}` },
				{ status: tweetResponse.status },
			);
		}

		const tweetData = await tweetResponse.json();

		return NextResponse.json({
			success: true,
			tweetId: tweetData.data.id,
			tweetUrl: `https://twitter.com/${userResponse.user.twitterUsername}/status/${tweetData.data.id}`,
		});
	} catch (error: any) {
		console.error("Twitter share error:", error);

		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : "Failed to share on Twitter",
			},
			{ status: 500 },
		);
	}
}
