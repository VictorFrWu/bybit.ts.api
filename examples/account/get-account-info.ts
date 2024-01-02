import { RestClientV5 } from "../../src";

const client = new RestClientV5({
  testnet: true,
  key: "8wYkmpLsMg10eNQyPm",
  secret: "Ouxc34myDnXvei54XsBZgoQzfGxO4bkr2Zsj",
});

client
  .getAccountInfo()
  .then((response) => {
    console.log(response);
  })
  .catch((error) => {
    console.error(error);
  });
