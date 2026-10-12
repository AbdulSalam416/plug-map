#include <netcdf.h>
/* Old writer:
   H5Fcreate("out.h5", H5F_ACC_TRUNC, H5P_DEFAULT, H5P_DEFAULT);
*/
int main() {
  int ncid;
  nc_open("in.nc", NC_NOWRITE, &ncid);  // nc_create("x.nc", NC_CLOBBER, &ncid);
  const char *url = "https://api.open-meteo.com/v1/forecast";
  return 0;
}
