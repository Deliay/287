import { HeroWall } from "@/components/hero-wall";
import { MemberSection } from "@/components/member-section";
import { SiteHeader } from "@/components/site-header";
import { SmoothScroll } from "@/components/smooth-scroll";
import { members } from "@/data/members";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <SmoothScroll />
      <main>
        <HeroWall members={members} />
        {members.map((member, index) => (
          <MemberSection key={member.id} member={member} index={index} />
        ))}
      </main>
    </>
  );
}
