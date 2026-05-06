import { NextRequest, NextResponse } from "next/server";
import { createVerify } from "crypto";
import { suppressEmail } from "@/lib/emailSuppression";

// Cache fetched signing certificates
const certCache = new Map<string, string>();

async function fetchCertificate(url: string): Promise<string> {
  const cached = certCache.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  const pem = await res.text();
  certCache.set(url, pem);
  return pem;
}

function buildStringToSign(message: Record<string, string>): string {
  const type = message.Type;
  if (type === "Notification") {
    const pairs: (string | null)[] = [
      "Message", message.Message,
      "MessageId", message.MessageId,
    ];
    if ("Subject" in message && message.Subject) {
      pairs.push("Subject", message.Subject);
    }
    pairs.push(
      "Timestamp", message.Timestamp,
      "TopicArn", message.TopicArn,
      "Type", message.Type,
    );
    return pairs.join("\n") + "\n";
  }
  // SubscriptionConfirmation or UnsubscribeConfirmation
  return [
    "Message", message.Message,
    "MessageId", message.MessageId,
    "SubscribeURL", message.SubscribeURL,
    "Timestamp", message.Timestamp,
    "Token", message.Token,
    "TopicArn", message.TopicArn,
    "Type", message.Type,
  ].join("\n") + "\n";
}

async function verifySnsSignature(message: Record<string, string>): Promise<boolean> {
  try {
    const certUrl = message.SigningCertURL;
    // Validate cert URL is from AWS
    if (!certUrl || !certUrl.startsWith("https://") || !certUrl.includes(".amazonaws.com/")) {
      console.error("[ses-webhook] Invalid SigningCertURL:", certUrl);
      return false;
    }
    const pem = await fetchCertificate(certUrl);
    const verifier = createVerify("SHA256WithRSA");
    verifier.update(buildStringToSign(message));
    return verifier.verify(pem, message.Signature, "base64");
  } catch (err) {
    console.error("[ses-webhook] Signature verification error:", err);
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    // SNS sends Content-Type: text/plain, so parse raw text as JSON
    const rawBody = await req.text();
    let body: Record<string, string>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error("[ses-webhook] Failed to parse body:", rawBody.slice(0, 200));
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const messageType = req.headers.get("x-amz-sns-message-type");
    console.log(`[ses-webhook] Received ${messageType} message`);

    // Pin the topic ARN so a forged message from any other SNS topic is rejected
    // even if its signature happens to verify against AWS's cert chain.
    const expectedTopicArn = process.env.SES_TOPIC_ARN;
    if (expectedTopicArn && body.TopicArn !== expectedTopicArn) {
      console.error("[ses-webhook] Unexpected TopicArn:", body.TopicArn);
      return NextResponse.json({ error: "Unexpected topic" }, { status: 403 });
    }

    // Verify SNS signature — never bypass, even for SubscriptionConfirmation.
    // A bypass lets attackers force the server to fetch arbitrary URLs and
    // replay forged Bounce/Complaint events to mass-suppress real emails.
    const signatureVersion = body.SignatureVersion;
    if (!(await verifySnsSignature(body))) {
      console.error("[ses-webhook] Invalid SNS signature (version:", signatureVersion, ")");
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    // Handle subscription confirmation
    if (messageType === "SubscriptionConfirmation") {
      console.log("[ses-webhook] Confirming SNS subscription");
      await fetch(body.SubscribeURL);
      return NextResponse.json({ status: "subscribed" });
    }

    // Handle notifications
    if (messageType === "Notification") {
      const notification = JSON.parse(body.Message);
      const notificationType = notification.notificationType;

      if (notificationType === "Bounce") {
        const bounce = notification.bounce;
        const isPermanent = bounce.bounceType === "Permanent";
        const recipients: { emailAddress: string }[] = bounce.bouncedRecipients || [];

        for (const recipient of recipients) {
          if (isPermanent) {
            await suppressEmail(
              recipient.emailAddress,
              "bounce",
              "ses-bounce",
              bounce.bounceSubType,
            );
          } else {
            console.log(`[ses-webhook] Transient bounce for ${recipient.emailAddress} (${bounce.bounceSubType})`);
          }
        }
      } else if (notificationType === "Complaint") {
        const complaint = notification.complaint;
        const recipients: { emailAddress: string }[] = complaint.complainedRecipients || [];

        for (const recipient of recipients) {
          await suppressEmail(
            recipient.emailAddress,
            "complaint",
            "ses-complaint",
            complaint.complaintFeedbackType,
          );
        }
      }

      return NextResponse.json({ status: "processed" });
    }

    return NextResponse.json({ status: "ignored" });
  } catch (err) {
    console.error("[ses-webhook] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
