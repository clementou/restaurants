#!/bin/sh
# Run only after approving recurring GitHub access to the shared Takeout folder.
set -eu
project=clementou-restaurants
account=clement.h.ou@gmail.com
provider=projects/462819755640/locations/global/workloadIdentityPools/github/providers/restaurants
if ! gcloud iam workload-identity-pools describe github --location=global --project="$project" --account="$account" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create github --location=global --project="$project" --account="$account" --display-name='Restaurant repository' --quiet
fi
if ! gcloud iam workload-identity-pools providers describe restaurants --location=global --workload-identity-pool=github --project="$project" --account="$account" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc restaurants --location=global --workload-identity-pool=github --project="$project" --account="$account" --issuer-uri=https://token.actions.githubusercontent.com --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id' --attribute-condition="assertion.repository_id == '1369517619' && assertion.repository_owner_id == '12637289' && assertion.ref == 'refs/heads/main'" --quiet
fi
gcloud iam service-accounts add-iam-policy-binding takeout-reader@clementou-restaurants.iam.gserviceaccount.com --project="$project" --account="$account" --member='principalSet://iam.googleapis.com/projects/462819755640/locations/global/workloadIdentityPools/github/attribute.repository_id/1369517619' --role=roles/iam.workloadIdentityUser --quiet
gh variable set GOOGLE_TAKEOUT_PROVIDER --repo clementou/restaurants --body "$provider"
