import { CompanyOverview } from "@/components/discover/CompanyOverview";

export default async function CompanyPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <CompanyOverview key={ticker} ticker={ticker} />;
}
