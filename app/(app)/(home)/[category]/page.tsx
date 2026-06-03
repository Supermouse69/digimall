interface Props {
    params:Promise<{
        category: string
    }>
}

const Page =async ({params}:Props) => {
    const {category} = await params;
    return (
        <div>
            Category page: {category}
        </div>
    );
};

export default Page;