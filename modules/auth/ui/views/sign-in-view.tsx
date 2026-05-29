"use client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Poppins } from "next/font/google";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { loginSchema } from "../../schemas";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import z from "zod";
import Link from "next/link";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["700"],
});

export const SignInView = () => {
    const queryClient = useQueryClient();
    const router = useRouter();
    const trpc = useTRPC();
    const login = useMutation(trpc.auth.login.mutationOptions({
        onError:(error)=>{
            toast.error(error.message);
        },
        onSuccess:async () =>{
            await queryClient.invalidateQueries(trpc.auth.session.queryFilter());//possible solution for the categories bug 6:38:06
            router.push("/");
        }
    }));


  const form = useForm<z.infer<typeof loginSchema>>({
    mode: "all",
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = (values: z.infer<typeof loginSchema>) => {
    login.mutate(values);
  };





  return (
    <div className="grid grid-cols-1 lg:grid-cols-5">
      <div className="bg-[#F4F4F0] h-screen w-full lg:col-span-3 overflow-y-auto">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-8 p-4 lg:p-16"
          >
            <div className="flex items-center justify-between mb-8">
              <Link href="/">
                <span
                  className={cn("text-2x1 font-semibold", poppins.className)}
                >
                  TON-618 XXXXXL 5:28:26
                </span>
              </Link>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-base border-none underline"
              >
                <Link prefetch href="/sign-up">
                  Sign-up
                </Link>
              </Button>
            </div>
            <h1 className="text-4x1 font-medium">
              Welcome Gay
            </h1>
            
            <FormField
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base"> Email</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base"> Password</FormLabel>
                  <FormControl>
                    <Input  {...field} type = "password"/>
                  </FormControl>
                  
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
            disabled={login.isPending}
            type="submit"
            size= "lg"
            variant= "elevated"
            className="bg-black text-white hover:bg-pink-400 hover:text-primary"
            >
                Log-In
            </Button>
          </form>
        </Form>
      </div>

      <div
        className="h-screen w-full lg:col-span-2 hidden lg:block"
        style={{
          backgroundImage: "url('ian.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
    </div>
  );
};
