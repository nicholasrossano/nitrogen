#!/usr/bin/env python3
"""
Seed the corpus with 5 clean cooking case studies.
Run after migrations: python scripts/seed_corpus.py
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.config import get_settings
from app.models.corpus import CorpusDocument, CorpusChunk
from app.services.embeddings import EmbeddingsService
from app.services.document_parser import DocumentParserService

settings = get_settings()

# Case study data
CASE_STUDIES = [
    {
        "title": "Kenya LPG Transition Study",
        "source": "Clean Cooking Alliance, 2023",
        "metadata": {
            "sector": "clean_cooking",
            "geography": "Kenya",
            "year": 2023,
            "tags": ["LPG", "urban", "peri-urban", "household adoption"],
            "organization": "Clean Cooking Alliance"
        },
        "content": """
Kenya LPG Transition Study: Household Adoption Patterns in Nairobi Peri-Urban Areas

Executive Summary:
This study examined LPG adoption patterns among 2,400 households in peri-urban Nairobi between 2020-2023. Key findings indicate that upfront cylinder costs remain the primary barrier to adoption, followed by supply chain reliability concerns.

Key Findings:

1. Adoption Barriers:
The study found that 67% of non-adopting households cited the initial cylinder deposit (typically $30-50) as their primary barrier. Secondary barriers included concerns about refill availability (42%) and safety perceptions (31%). Interestingly, ongoing fuel costs were cited by only 18% of respondents, suggesting that once the initial barrier is overcome, households find LPG economically viable.

2. Successful Intervention Models:
Pay-as-you-go (PAYG) cylinder programs showed the highest adoption rates, with 78% of participants maintaining consistent LPG use after 12 months. Traditional distribution models showed only 45% sustained adoption. The PAYG model reduced the effective upfront cost from $45 to $5, making it accessible to lower-income households.

3. Gender Dynamics:
Women were the primary decision-makers for cooking fuel in 73% of surveyed households. However, men controlled household finances in 61% of cases, creating a decision-making disconnect. Programs that engaged both partners showed 34% higher adoption rates than those targeting only one gender.

4. Health Outcomes:
Households that fully transitioned to LPG reported a 52% reduction in respiratory symptoms among women and children. Partial adopters (those using LPG alongside traditional fuels) showed only a 23% reduction, highlighting the importance of complete fuel switching for health benefits.

Recommendations:
- Prioritize PAYG and cylinder financing models to address upfront cost barriers
- Ensure last-mile distribution reliability before scaling adoption programs
- Design interventions that engage both women (primary users) and men (financial decision-makers)
- Track sustained adoption, not just initial uptake, as the success metric
"""
    },
    {
        "title": "Ethiopia Ethanol Cookstove Pilot",
        "source": "Project Gaia, 2022",
        "metadata": {
            "sector": "clean_cooking",
            "geography": "Ethiopia",
            "year": 2022,
            "tags": ["ethanol", "CleanCook stove", "refugee camps", "urban"],
            "organization": "Project Gaia"
        },
        "content": """
Ethiopia Ethanol Cookstove Pilot: CleanCook Stove Deployment Outcomes

Background:
Project Gaia deployed 15,000 ethanol-burning CleanCook stoves across three regions of Ethiopia: Addis Ababa urban areas, Tigray refugee camps, and Oromia rural communities. The pilot ran from 2019-2022 with support from the Ethiopian government and international donors.

Implementation Results:

1. Urban Deployment (Addis Ababa):
The urban pilot achieved 89% sustained usage after 18 months. Key success factors included reliable ethanol supply chains and the stove's compatibility with traditional cooking practices (injera preparation). Users reported average fuel cost savings of 15% compared to charcoal, though this varied significantly with ethanol pricing.

2. Refugee Camp Deployment (Tigray):
Adoption in refugee settings was initially high (95%) due to free distribution, but sustained use dropped to 62% after 12 months. The primary challenge was ethanol supply disruption during the regional conflict. When supply was consistent, user satisfaction was 87%. This highlights the critical importance of supply chain resilience in humanitarian settings.

3. Rural Deployment (Oromia):
Rural adoption faced the greatest challenges, with only 41% sustained use. Factors included distance to ethanol refill points (average 12km), preference for multi-fuel flexibility, and lower household incomes making ongoing fuel purchases difficult. Households with agricultural income showed more consistent adoption due to seasonal cash availability.

Health Impact Assessment:
Indoor air quality monitoring in 200 households showed:
- 78% reduction in PM2.5 exposure compared to three-stone fire baseline
- 65% reduction in CO exposure
- Women reported 43% less time spent on fuel collection
- Burn injuries decreased by 71% compared to open fire cooking

Economic Analysis:
Total cost of ownership over 3 years: $180 per household (stove + fuel)
Charcoal baseline comparison: $240 per household
Net savings: $60 per household, with additional health cost savings estimated at $85

Lessons Learned:
- Ethanol infrastructure investment must precede or accompany stove distribution
- Refugee and emergency settings require buffer stock strategies
- Rural deployment needs mobile distribution or community fuel depots
- Stove design for local cooking practices (especially injera) is essential for Ethiopian context
"""
    },
    {
        "title": "India PMUY Impact Assessment",
        "source": "Ministry of Petroleum, Government of India, 2023",
        "metadata": {
            "sector": "clean_cooking",
            "geography": "India",
            "year": 2023,
            "tags": ["LPG", "government program", "subsidy", "rural", "BPL households"],
            "organization": "Government of India"
        },
        "content": """
Pradhan Mantri Ujjwala Yojana (PMUY) Impact Assessment: Five-Year Review

Program Overview:
PMUY, launched in 2016, aimed to provide free LPG connections to 80 million below-poverty-line (BPL) households. By 2023, the program had distributed 96.4 million connections, exceeding its target by 20%. This assessment examines outcomes, challenges, and lessons learned.

Adoption and Usage Patterns:

1. Connection vs. Consumption Gap:
While 96.4 million connections were distributed, average annual refill rates tell a different story:
- Year 1 post-connection: 3.2 refills average
- Year 3 post-connection: 4.1 refills average
- Year 5 post-connection: 5.8 refills average
The "desired" annual consumption for full LPG cooking is approximately 8-10 cylinders, indicating significant stacking with traditional fuels continues.

2. Regional Variation:
States with stronger LPG distribution infrastructure (Gujarat, Maharashtra) showed refill rates of 6.5-7.2 cylinders annually. States with weaker infrastructure (Bihar, Jharkhand) showed rates of 2.8-3.4 cylinders, despite similar connection numbers.

3. Subsidy Impact:
The Direct Benefit Transfer (DBT) subsidy, averaging $3.50 per cylinder, was critical for sustained adoption. When subsidy delivery was delayed, refill rates dropped by 34%. When cylinder prices exceeded $12 (pre-subsidy), adoption rates declined sharply.

Behavioral and Social Outcomes:

1. Women's Empowerment:
Surveys of 50,000 PMUY beneficiaries found:
- 67% of women reported reduced time spent on fuel collection (average 1.5 hours/day saved)
- 45% reported using saved time for income-generating activities
- 38% reported improved family health, particularly among children

2. Health Outcomes:
A controlled study comparing 5,000 PMUY households with matched non-beneficiaries found:
- 28% reduction in acute respiratory infections among children under 5
- 19% reduction in reported eye irritation and respiratory symptoms in women
- However, benefits were significantly higher in "exclusive LPG" households vs. "stacking" households

Challenges and Recommendations:

1. Affordability remains the primary barrier to full transition. Even with subsidies, the poorest households struggle with the $8-10 per cylinder cost (post-subsidy).

2. Distribution network gaps in rural and remote areas limit access. Approximately 23% of PMUY beneficiaries report difficulty accessing refills within reasonable distance.

3. Behavior change campaigns have been insufficient. Many households have not abandoned traditional fuels due to taste preferences, backup concerns, or habit.

Recommendations for similar programs:
- Ensure subsidy mechanisms are reliable and timely
- Invest in last-mile distribution before or alongside connection drives
- Set refill rate targets, not just connection targets
- Design graduated subsidy schemes that reduce over time as behavior changes
"""
    },
    {
        "title": "Ghana Improved Cookstove RCT",
        "source": "University of Ghana / Columbia University, 2022",
        "metadata": {
            "sector": "clean_cooking",
            "geography": "Ghana",
            "year": 2022,
            "tags": ["improved cookstoves", "biomass", "RCT", "health outcomes", "rural"],
            "organization": "University of Ghana"
        },
        "content": """
Ghana Improved Cookstove Randomized Controlled Trial: Health Outcomes from Biomass Stove Upgrades

Study Design:
This randomized controlled trial (RCT) evaluated the health impacts of improved biomass cookstoves (ICS) compared to traditional three-stone fires. The study enrolled 1,800 households across 60 rural communities in the Ashanti and Brong-Ahafo regions, with a 24-month follow-up period.

Intervention:
Treatment households received an improved chimney cookstove (local manufacture, Gyapa-type) plus behavior change communication. Control households continued with existing cooking practices. Compliance was monitored through stove use monitors (SUMs) and monthly household visits.

Key Findings:

1. Stove Usage Patterns:
- 71% of treatment households used the ICS as their primary stove at 24 months
- Average daily use: 2.3 hours on ICS vs. 3.1 hours on traditional stoves
- Fuel stacking persisted in 43% of treatment households
- ICS usage was higher in wet season when fuel scarcity made efficiency more valuable

2. Air Quality Outcomes:
24-hour personal PM2.5 exposure measurements:
- Treatment group mean: 85 µg/m³ (95% CI: 72-98)
- Control group mean: 142 µg/m³ (95% CI: 125-159)
- Reduction: 40% (p<0.001)

Kitchen area monitoring showed:
- Treatment: 156 µg/m³
- Control: 287 µg/m³
- Reduction: 46%

Note: Even treatment group exposures remained well above WHO guidelines (25 µg/m³ 24-hour mean), indicating ICS alone is insufficient to achieve safe exposure levels.

3. Health Outcomes:
Primary outcome - Acute Lower Respiratory Infection (ALRI) in children under 5:
- Treatment incidence: 0.42 episodes per child-year
- Control incidence: 0.58 episodes per child-year
- Incidence rate ratio: 0.72 (95% CI: 0.58-0.89)
- NNT (Number Needed to Treat): 6.3 households to prevent one ALRI episode

Secondary outcomes:
- Blood pressure reduction in women: -3.2 mmHg systolic (p=0.04)
- Reported eye irritation: 34% reduction
- Reported cough: 28% reduction

4. Economic Analysis:
- Stove cost: $25 (subsidized from $40 manufacturing cost)
- Estimated fuel savings: $18/year
- Payback period: 14 months
- Health cost savings (estimated): $12/year per household

Limitations:
- Open trial design (blinding not possible)
- Potential Hawthorne effect on reported symptoms
- Compliance challenges in rainy season
- Generalizability limited to similar agroecological zones

Conclusions:
Improved biomass stoves can deliver meaningful but modest health benefits. They should be considered a transitional technology rather than an end goal. Programs should aim for cleaner fuels (LPG, electricity) where feasible, using ICS as an interim solution or for populations where cleaner fuels are not accessible.
"""
    },
    {
        "title": "Cambodia Biogas Program Review",
        "source": "National Biodigester Programme Cambodia, 2023",
        "metadata": {
            "sector": "clean_cooking",
            "geography": "Cambodia",
            "year": 2023,
            "tags": ["biogas", "rural", "livestock integration", "NBP"],
            "organization": "National Biodigester Programme"
        },
        "content": """
Cambodia National Biodigester Programme: Rural Biogas Adoption Analysis

Program Background:
The National Biodigester Programme (NBP) has operated in Cambodia since 2006, installing over 28,000 household biodigesters by 2023. This review examines adoption patterns, sustainability, and lessons for scaling.

Implementation Model:

1. Technology:
Fixed-dome biodigesters (4-6 m³ capacity) designed for household use with 2-4 cattle or equivalent livestock. Initial cost: $350-500, with $150 subsidy provided. Farmer contribution through labor and local materials. 10-year warranty with trained local technicians.

2. Targeting Criteria:
- Household must own minimum 2 cattle or 4-6 pigs
- Access to water for slurry mixing
- Commitment to daily feeding and maintenance
- Participation in training program

Performance Analysis:

1. Functional Status:
Survey of 5,000 installations found:
- 78% fully functional after 5 years
- 12% partially functional (reduced gas production)
- 10% non-functional (structural failure or abandonment)
Primary failure modes: cracking (5%), blocked pipes (3%), abandonment after livestock sale (2%)

2. Usage Patterns:
Functional biodigester households reported:
- Average 3.2 hours daily cooking on biogas
- 67% reported biogas meets "most" cooking needs
- 33% supplement with firewood or LPG for high-heat cooking
- Dry season gas production 15-20% lower than wet season due to water scarcity

3. Economic Benefits:
Compared to matched control households:
- Annual fuel cost savings: $85 (firewood) to $120 (charcoal baseline)
- Bioslurry use reduced fertilizer costs by $45/year average
- Total annual benefit: $130-165
- Payback period: 2.1 years (with subsidy), 3.4 years (without)

4. Environmental Impact:
Per household annual reductions:
- 2.1 tonnes CO2 equivalent from avoided biomass burning
- 850 kg firewood saved
- Methane capture from manure (would otherwise emit to atmosphere)
Aggregate program impact: 58,000 tonnes CO2e avoided annually

5. Gender and Social Outcomes:
- Women report average 1.8 hours/day time savings
- 52% of saved time used for income activities or childcare
- Improved kitchen cleanliness and reduced smoke reported by 89%
- Social status improvement reported by 45% ("modern" household perception)

Challenges and Lessons:

1. Livestock Dependency:
Biogas viability is directly tied to livestock ownership. Households that sold cattle (often during economic stress) abandoned biodigesters. Programs should consider livestock volatility in targeting.

2. Technical Support:
Regions with active technician networks showed 91% functionality vs. 68% in areas with weak support. Investment in after-sales service is critical.

3. Seasonal Variation:
Gas production fluctuates with temperature and water availability. Households need backup cooking options or storage systems.

4. Scaling Constraints:
Only ~15% of Cambodian rural households meet the livestock ownership criteria. Biogas is a niche solution, not a universal one. Community-scale systems may expand addressable market.

Recommendations for Replication:
- Ensure robust livestock ownership in target population
- Invest heavily in technician training and retention
- Build in flexible payment options for farmer contribution
- Set realistic expectations about biogas as primary vs. supplementary fuel
- Integrate with agricultural extension for bioslurry utilization
"""
    }
]


async def seed_corpus():
    """Seed the corpus with case studies"""
    print("Connecting to database...")
    engine = create_async_engine(settings.database_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    parser = DocumentParserService()
    embeddings_service = EmbeddingsService()
    
    async with async_session() as session:
        for study in CASE_STUDIES:
            print(f"\nProcessing: {study['title']}...")
            
            # Check if already exists
            from sqlalchemy import select
            existing = await session.execute(
                select(CorpusDocument).where(CorpusDocument.title == study['title'])
            )
            if existing.scalar_one_or_none():
                print(f"  Already exists, skipping...")
                continue
            
            # Create document
            doc = CorpusDocument(
                title=study['title'],
                source=study['source'],
                file_type='text',
                doc_metadata=study['metadata'],
            )
            session.add(doc)
            await session.commit()
            await session.refresh(doc)
            print(f"  Created document: {doc.id}")
            
            # Chunk content
            chunks = parser.chunk_text(study['content'])
            print(f"  Created {len(chunks)} chunks")
            
            # Generate embeddings
            print(f"  Generating embeddings...")
            embeddings = await embeddings_service.embed_texts(chunks)
            
            # Store chunks
            for i, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
                chunk = CorpusChunk(
                    corpus_doc_id=doc.id,
                    chunk_index=i,
                    content=chunk_text,
                    embedding=embedding,
                )
                session.add(chunk)
            
            await session.commit()
            print(f"  Stored {len(chunks)} chunks with embeddings")
        
        print("\n✓ Corpus seeding complete!")
    
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_corpus())
