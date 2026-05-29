import { SignInView } from "@/modules/auth/ui/views/sign-in-view";
import { redirect } from "next/navigation";
import { caller } from "@/trpc/server";

const Page=async ()=>{
    const session = await caller.auth.session();
    if (session.user){
        redirect("/");
    }
    return <SignInView/>
}
export default Page;