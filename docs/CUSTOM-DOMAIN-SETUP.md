# Custom Domain Setup for ECS Architecture

This guide explains how to use a custom domain (e.g. `images.scannable.io`) with the CloudFront distribution that fronts the DIT image processing endpoint.

### Step 1: Request an ACM Certificate in us-east-1

**Important:** CloudFront only uses certificates from the **us-east-1** region.

1. Open [AWS Certificate Manager](https://console.aws.amazon.com/acm/home?region=us-east-1) in **us-east-1**
2. Click **Request a certificate**
3. Choose **Request a public certificate**
4. Add your domain: `images.scannable.io` (or `*.scannable.io` to cover multiple subdomains)
5. Choose **DNS validation** and follow the prompts to add the validation CNAME records to your DNS
6. Wait for the certificate status to be **Issued**

### Step 2: Add Alternate Domain Name and Certificate to CloudFront

1. Open [CloudFront console](https://console.aws.amazon.com/cloudfront/v3/home)
2. Find your **Image Handler Distribution** (the one with domain `d1xqf632fqafmb.cloudfront.net`)
3. Click the distribution ID → **Edit**
4. Under **Alternate domain names (CNAMEs)**, add: `images.scannable.io`
5. Under **Custom SSL certificate**, select the ACM certificate you created in Step 1
6. Save changes — distribution will deploy (typically 5–15 minutes)

### Step 3: Verify DNS

Ensure your CNAME record points to the CloudFront domain:

- **Name:** `images` (or `images.scannable.io` depending on your DNS provider)
- **Value:** `xxx.cloudfront.net`

> **Note:** Do **not** include `https://` in the CNAME value — only the hostname.

## Verification

After the CloudFront distribution finishes deploying:

- `https://images.scannable.io/` should load (you may get a 404 or redirect if there is no default path)
- Test image URLs: `https://images.scannable.io/<path-to-image>?w=400`

## Host-Based Mapping

The DIT service uses the `dit-host` header for host-based origin mapping (see `MappingResolver`). When using a custom domain, you may need to configure a **host mapping** in the DIT admin portal for `images.scannable.io` if you want path resolution to work differently than your default path mappings.

## CDK Deployment with Custom Domain (Optional)

To deploy with a custom domain baked into the CloudFront distribution from the start, use CDK context:

```bash
cd source/constructs

overrideWarningsEnabled=false npx cdk deploy v8-Stack \
  -c imageProcessingDomainName=images.scannable.io \
  -c imageProcessingCertificateArn=arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERT_ID \
  --parameters AdminEmail=your@email.com \
  --profile <PROFILE_NAME>
```

Or add to `cdk.json`:

```json
{
  "context": {
    "imageProcessingDomainName": "images.scannable.io",
    "imageProcessingCertificateArn": "arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERT_ID"
  }
}
```

Both context values must be set together; if only one is provided, the custom domain config is skipped.
